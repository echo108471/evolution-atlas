# Prototype a decision

Use a prototype when a concrete design or behavior question can be settled
cheaply by observing a working sketch. It is an instrument for choosing a
direction. The production implementation follows the relevant architecture or
implementation workflow.

## Choose the question

Write the decision in one sentence and name the observation that would settle
it. Examples include whether a caller can use a proposed interface, whether a
layout fits at the real viewport, or whether an operation's cost changes with
history size. If the remaining choice is a product preference that no
experiment can answer, present the options to the user.

Build two or three materially different options when more than one plausible
shape exists. Do not manufacture variants when evidence already points to one
appropriate design.

## Make the smallest instrument

Keep the prototype in an ignored scratch location, separate from production
source and public assets. Use synthetic repository data unless the user has
authorized a specific real repository. Include only enough code to expose the
question. Skip production polish and tests.

Drive the matching surface with the project's verification tooling. Capture
the observation that answers the question: a screenshot, interaction result,
timing, output shape, or other relevant artifact. Record the source revision
and conditions needed to repeat it.

## Decide and clean up

Compare the options against the stated question. Report what the observation
supports, what it does not establish, the tradeoffs, and the recommended
direction. Link the chosen shape to its actual caller and verification path.
Keep useful evidence in ignored scratch storage until the user can inspect it;
remove only prototype files created for this decision after preserving that
evidence.

A prototype is not a product change and does not establish full behavior,
semantic quality, or production performance. Use the standard implementation
and verification workflow for those claims.
