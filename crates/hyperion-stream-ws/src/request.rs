use hyperion_stream_core::Failure;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Bound {
    Block(i64),
    Timestamp(String),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FilterOperator {
    Eq,
    Ne,
    Gt,
    Lt,
    Gte,
    Lte,
    Contains,
    StartsWith,
    EndsWith,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum FilterValue {
    String(String),
    Number(serde_json::Number),
    Bool(bool),
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Filter {
    pub field: String,
    pub value: FilterValue,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub operator: Option<FilterOperator>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub asset: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FilterOp {
    And,
    Or,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Query {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_from: Option<Bound>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub read_until: Option<Bound>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub ignore_live: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filter_op: Option<FilterOp>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub filters: Vec<Filter>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct ActionRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contract: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub action: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account: Option<String>,
    #[serde(flatten)]
    pub query: Query,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct DeltaRequest {
    pub code: String,
    pub table: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scope: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payer: Option<String>,
    #[serde(flatten)]
    pub query: Query,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Request {
    Action(ActionRequest),
    Delta(DeltaRequest),
}

impl Request {
    /// Server validation remains authoritative for selectors, ABI and filter support.
    pub fn validate(&self) -> Result<(), Failure> {
        let query = match self {
            Self::Action(a) => &a.query,
            Self::Delta(d) => &d.query,
        };
        let bad_bound = |bound: &Option<Bound>| match bound {
            Some(Bound::Block(n)) => *n < -(u32::MAX as i64) || *n > u32::MAX as i64,
            Some(Bound::Timestamp(s)) => s.is_empty() || s.len() > 64,
            None => false,
        };
        if bad_bound(&query.start_from)
            || bad_bound(&query.read_until)
            || query.filters.len() > 256
            || query
                .filters
                .iter()
                .any(|f| f.field.is_empty() || f.field.len() > 256)
        {
            return Err(Failure::new(
                "INVALID_REQUEST",
                "Invalid query bound or filters",
                false,
            ));
        }
        if let Self::Delta(d) = self {
            if d.code.is_empty() || d.table.is_empty() {
                return Err(Failure::new(
                    "INVALID_REQUEST",
                    "Delta code/table are required",
                    false,
                ));
            }
        }
        Ok(())
    }
}
