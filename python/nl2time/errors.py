"""Error types for nl2time (port of the JS reference errors)."""


class ConfigError(Exception):
    """Invalid TimeContext configuration (bad now / locale / timeZone)."""


class NotResolvableError(Exception):
    """The expression is representable but not resolvable (e.g. `recur` in v1)."""


class AmbiguityError(Exception):
    """resolve_one() found no candidates."""


class IRValidationError(Exception):
    """Structural validation of a TimeExpr failed."""

    def __init__(self, message: str, path: str) -> None:
        super().__init__(f"{path}: {message}")
        self.path = path
