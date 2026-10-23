//! Optional native WebSocket adapter. See protocol/v1 for the experimental wire contract.
#![doc = include_str!("../README.md")]

pub mod codec;
mod request;
pub use request::*;
mod client;
pub use client::{Options, WsClient};
pub use hyperion_stream_core as core;
