# Delta Spec: om-remove-force → memory capability

## Modified Requirements

### MODIFIED: Observer Trigger and Buffering

The system MUST track unobserved tokens and trigger buffering/activation using an async-first pipeline. The synchronous `force` observer path MUST NOT exist.

#### Scenario: Tokens below buffer threshold

- GIVEN a session has `< bufferTokens` accumulated message tokens
- WHEN a turn completes
- THEN the system MUST return `"idle"`
- AND MUST NOT trigger Observer work

#### Scenario: Tokens reach buffer interval

- GIVEN accumulated message tokens cross a new buffer interval
- AND total accumulated message tokens are still below the activation threshold
- WHEN a turn completes
- THEN the system MUST trigger a background buffer pre-compute
- AND MUST NOT block the main session loop

#### Scenario: Tokens reach activation threshold

- GIVEN accumulated message tokens reach the effective activation threshold
- WHEN a turn completes
- THEN the system MUST activate the Observer using the buffered chunks and unobserved messages
- AND the activation MUST run in a non-blocking fiber

#### Scenario: Tokens exceed blockAfter threshold

- GIVEN accumulated message tokens exceed `blockAfter`
- AND a buffering or activation operation is already in flight
- WHEN a turn completes
- THEN the system MUST apply backpressure by waiting for the in-flight OM work to complete
- AND MUST NOT run a second synchronous observer path
- AND MUST NOT duplicate observation/reflection logic

#### Scenario: No synchronous force path exists

- GIVEN the OM runtime code
- WHEN Observer thresholds are evaluated
- THEN the system MUST NOT return a `"force"` signal
- AND the prompt loop MUST NOT contain a `sig === "force"` branch

### MODIFIED: Observer Threshold Configuration

The OM runtime MUST expose `observer_block_after` and MUST NOT expose `observer_force_tokens`.

#### Scenario: observer_force_tokens removed

- GIVEN the user configuration schema
- WHEN experimental OM settings are listed
- THEN `observer_force_tokens` MUST NOT exist

#### Scenario: observer_block_after custom value

- GIVEN `experimental.observer_block_after` is set
- WHEN accumulated tokens exceed that threshold
- THEN the system MUST apply backpressure at that threshold

#### Scenario: observer_block_after default

- GIVEN `experimental.observer_block_after` is unset
- WHEN the effective activation threshold is known
- THEN the runtime MUST default `blockAfter` to `1.2x` the activation threshold
- AND this MUST mirror Mastra's default behavior
