mod shared;

use crate::shared::{build_message, Message};

pub fn render_message(name: &str) -> Message {
    build_message(name)
}
