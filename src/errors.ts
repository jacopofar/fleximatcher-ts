/**
 * Exception hierarchy for fleximatcher.
 *
 * Every error thrown by the library extends {@link FlexiMatcherError}, so a
 * single catch clause can distinguish library failures from programming
 * mistakes in the surrounding application.
 */

/** Base class for every error raised by fleximatcher. */
export class FlexiMatcherError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** The pattern (or one of its chunks) is malformed. */
export class PatternError extends FlexiMatcherError {}

/** A pattern refers to a rule name that has not been bound. */
export class UnknownRuleError extends PatternError {}

/** A pattern refers to a macro that has not been defined. */
export class UnknownMacroError extends PatternError {}

/** A rule could not be created or used. */
export class RuleError extends FlexiMatcherError {}

/** A tag name is not known to the matcher. */
export class UnknownTagError extends FlexiMatcherError {}

/** An annotation template could not be expanded into valid data. */
export class AnnotationError extends FlexiMatcherError {}

/** Tag expansion exceeded the configured maximum nesting level. */
export class MaxNestingError extends FlexiMatcherError {}
