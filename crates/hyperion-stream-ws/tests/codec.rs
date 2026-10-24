use hyperion_stream_core::{Command, Input, Scope};
use hyperion_stream_ws::codec::{decode, encode};

#[test]
fn shared_cross_language_wire_vectors() {
    let corpus: serde_json::Value =
        serde_json::from_str(include_str!("../../../conformance/v1/wire-vectors.json")).unwrap();
    for case in corpus["cases"].as_array().unwrap() {
        let result = decode(case["text"].as_str().unwrap());
        assert_eq!(
            result.is_ok(),
            case["valid"].as_bool().unwrap(),
            "{}: {:?}",
            case["name"],
            result
        );
    }
}

#[test]
fn exact_uint64_and_arbitrary_contract_json_survive_the_wire_boundary() {
    let text = r#"{"type":"data","connection_id":"1","stream_id":"1","generation":"1","subscription_id":"100","sequence":"18446744073709551615","mode":"history","records":[{"block_num":100,"block_id":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","cursor":"18446744073709551615","payload":{"global_sequence":"18446744073709551615","act":{"data":{"global_sequence":42,"amount":"1.0000 EOS"}}}}]}"#;
    let Input::Data(batch) = decode(text).unwrap() else {
        panic!("data");
    };
    assert_eq!(batch.sequence, u64::MAX);
    assert_eq!(batch.wire_bytes, text.len());
    assert_eq!(
        batch.records[0].payload["act"]["data"]["global_sequence"],
        42
    );
    let ack: Command<serde_json::Value> = Command::Ack {
        scope: Scope {
            connection_id: 1,
            stream_id: 1,
            generation: 1,
            subscription_id: 100,
        },
        sequence: u64::MAX,
    };
    let actual: serde_json::Value = serde_json::from_str(&encode(&ack).unwrap()).unwrap();
    assert_eq!(actual["sequence"], "18446744073709551615");
}
