"""nl2time: natural language <-> dates/times, language-neutral IR core.

Python port of the JS reference (see docs/porting.md in the repository).
v0: IR types + structural validator, TimeContext, and the deterministic
engine `resolve()`. Parsers and describe() land in later phases.
"""

from . import errors
from .context import TimeContext
from .engine import MAX_CANDIDATES, resolve, resolve_one, value_to_json
from .ir import IR_VERSION, validate_expr

__all__ = [
    "IR_VERSION",
    "MAX_CANDIDATES",
    "TimeContext",
    "errors",
    "resolve",
    "resolve_one",
    "validate_expr",
    "value_to_json",
]

__version__ = "0.0.1"
