use hyperion_stream_core::*;

fn hello(connection_id: u64) -> Hello {
    Hello {
        version: 1,
        chain_id: "a".repeat(64),
        connection_id,
        heartbeat_interval_ms: 15_000,
    }
}

#[test]
fn a_consumed_batch_returns_credit_with_exact_cursor_and_scope() {
    let mut client = Client::<String, String>::new(Config::default()).unwrap();
    client.receive(Input::Hello(hello(1))).unwrap();
    let attempt = client
        .subscribe(7, "action request".into(), Delivery::Head, true)
        .unwrap();
    assert!(matches!(
        &attempt.commands[0],
        Command::Subscribe {
            request_id: 1,
            generation: 1,
            ..
        }
    ));
    let scope = Scope {
        connection_id: 1,
        stream_id: 7,
        generation: 1,
        subscription_id: 100,
    };
    client
        .receive(Input::Accepted {
            scope: scope.clone(),
            request_id: 1,
            start_from: 100,
        })
        .unwrap();
    client
        .receive(Input::Data(Batch {
            scope: scope.clone(),
            sequence: 1,
            mode: Mode::History,
            records: vec![Record {
                block_num: 100,
                block_id: "b".repeat(64),
                cursor: Some(u64::MAX),
                payload: "arbitrary contract data".into(),
            }],
            wire_bytes: 400,
        }))
        .unwrap();
    let result = client.poll();
    assert!(
        matches!(&result.events[0], Event::Data(batch) if batch.records[0].cursor == Some(u64::MAX))
    );
    assert_eq!(result.commands, vec![Command::Ack { scope, sequence: 1 }]);
    assert!(client.poll().events.is_empty());
}

#[test]
fn outage_discards_unconfirmed_data_and_repeated_outages_keep_the_earliest_anchor() {
    let mut client = Client::<String, String>::new(Config::default()).unwrap();
    client.receive(Input::Hello(hello(1))).unwrap();
    client
        .subscribe(1, "request".into(), Delivery::Irreversible, true)
        .unwrap();
    let scope = Scope {
        connection_id: 1,
        stream_id: 1,
        generation: 1,
        subscription_id: 100,
    };
    client
        .receive(Input::Accepted {
            scope: scope.clone(),
            request_id: 1,
            start_from: 100,
        })
        .unwrap();
    client
        .receive(Input::Data(Batch {
            scope: scope.clone(),
            sequence: 1,
            mode: Mode::History,
            records: vec![Record {
                block_num: 100,
                block_id: "b".repeat(64),
                cursor: None,
                payload: "old-fork".into(),
            }],
            wire_bytes: 400,
        }))
        .unwrap();
    assert!(client.poll().events.is_empty());
    client.disconnect().unwrap();
    let reconnect = client.receive(Input::Hello(hello(2))).unwrap();
    assert!(matches!(
        &reconnect.commands[1],
        Command::Subscribe {
            generation: 2,
            resume_from: Some(100),
            ..
        }
    ));
    client
        .receive(Input::Accepted {
            scope: Scope {
                connection_id: 2,
                generation: 2,
                ..scope.clone()
            },
            request_id: 2,
            start_from: 100,
        })
        .unwrap();
    client.disconnect().unwrap();
    let reconnect = client.receive(Input::Hello(hello(3))).unwrap();
    assert!(matches!(
        &reconnect.commands[1],
        Command::Subscribe {
            generation: 3,
            resume_from: Some(100),
            ..
        }
    ));
    client
        .receive(Input::Lib(Lib {
            connection_id: 3,
            chain_id: "a".repeat(64),
            block_num: 200,
            block_id: "c".repeat(64),
        }))
        .unwrap();
    assert!(
        client.poll().events.is_empty(),
        "a later LIB must not release the old fork payload"
    );
    assert!(client.receive(Input::End(scope)).unwrap().events.is_empty());
}

#[test]
fn fork_replacement_fences_old_data_and_cancellation_stops_new_delivery() {
    let mut client = Client::<String, String>::new(Config::default()).unwrap();
    client.receive(Input::Hello(hello(1))).unwrap();
    client
        .subscribe(1, "request".into(), Delivery::Irreversible, true)
        .unwrap();
    let scope = Scope {
        connection_id: 1,
        stream_id: 1,
        generation: 1,
        subscription_id: 100,
    };
    client
        .receive(Input::Accepted {
            scope: scope.clone(),
            request_id: 1,
            start_from: 100,
        })
        .unwrap();
    let batch = Batch {
        scope: scope.clone(),
        sequence: 1,
        mode: Mode::History,
        records: vec![Record {
            block_num: 100,
            block_id: "b".repeat(64),
            cursor: None,
            payload: "old".into(),
        }],
        wire_bytes: 400,
    };
    client.receive(Input::Data(batch.clone())).unwrap();
    let fork = client
        .receive(Input::Fork(Fork {
            connection_id: 1,
            chain_id: "a".repeat(64),
            starting_block: 100,
            ending_block: 101,
            new_block_id: "c".repeat(64),
        }))
        .unwrap();
    assert!(matches!(
        &fork.commands[..],
        [
            Command::Cancel { generation: 1, .. },
            Command::Subscribe {
                generation: 2,
                resume_from: Some(100),
                ..
            }
        ]
    ));
    client.receive(Input::Data(batch)).unwrap();
    client
        .receive(Input::Lib(Lib {
            connection_id: 1,
            chain_id: "a".repeat(64),
            block_num: 101,
            block_id: "c".repeat(64),
        }))
        .unwrap();
    assert!(client.poll().events.is_empty());
    let cancel = client.cancel(1);
    assert!(matches!(
        &cancel.commands[..],
        [Command::Cancel {
            subscription_id: None,
            generation: 2,
            ..
        }]
    ));
    assert_eq!(cancel.events, vec![Event::Cancelled { stream_id: 1 }]);
    assert_eq!(client.stream_count(), 0);
}

#[test]
fn equal_lib_and_heartbeats_do_not_hide_stalled_finality_or_request_acceptance() {
    let config = Config {
        request_timeout_ms: 20,
        lib_timeout_ms: 30,
        ..Config::default()
    };
    let mut client = Client::<String, String>::new(config).unwrap();
    client.receive(Input::Hello(hello(1))).unwrap();
    client
        .subscribe(1, "pending request".into(), Delivery::Head, true)
        .unwrap();
    assert!(client.advance(19).unwrap().events.is_empty());
    let timeout = client.advance(20).unwrap();
    assert!(matches!(&timeout.events[0], Event::Error(e) if e.code == "REQUEST_TIMEOUT"));
    client
        .subscribe(2, "LIB request".into(), Delivery::Irreversible, true)
        .unwrap();
    let scope = Scope {
        connection_id: 1,
        stream_id: 2,
        generation: 2,
        subscription_id: 101,
    };
    client
        .receive(Input::Accepted {
            scope: scope.clone(),
            request_id: 2,
            start_from: 100,
        })
        .unwrap();
    client
        .receive(Input::Lib(Lib {
            connection_id: 1,
            chain_id: "a".repeat(64),
            block_num: 99,
            block_id: "b".repeat(64),
        }))
        .unwrap();
    client
        .receive(Input::Data(Batch {
            scope,
            sequence: 1,
            mode: Mode::History,
            records: vec![Record {
                block_num: 100,
                block_id: "c".repeat(64),
                cursor: None,
                payload: "waiting".into(),
            }],
            wire_bytes: 400,
        }))
        .unwrap();
    client.advance(49).unwrap();
    client.receive(Input::Ping(1)).unwrap();
    client
        .receive(Input::Lib(Lib {
            connection_id: 1,
            chain_id: "a".repeat(64),
            block_num: 99,
            block_id: "b".repeat(64),
        }))
        .unwrap();
    let timeout = client.advance(50).unwrap();
    assert!(
        matches!(&timeout.events[0], Event::Error(e) if e.code == "LIB_TIMEOUT" && e.retryable)
    );
    assert!(
        client.advance(49).is_err(),
        "injected time must be monotonic"
    );
}
