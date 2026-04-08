# Embedder Configuration Specification

## Purpose

Zero-config embedder setup with optional configuration overrides for remote providers.

## Requirements

### Requirement: Default Embedder

The system MUST provide a default local embedder if no configuration is specified.

#### Scenario: First run without config

- GIVEN no `experimental.memory.embedder` config is set
- WHEN the embedder is initialized
- THEN the system downloads fastembed BGE-Small-EN-v1.5 to `~/.cache/lightcode/fastembed-models`
- AND initializes it for use

#### Scenario: Default embedder download fails

- GIVEN no config is set
- AND the fastembed download fails
- WHEN initialization completes
- THEN the system degrades gracefully to FTS5-only mode

### Requirement: Configured Embedder Override

The system SHALL support configuring custom remote embedders.

#### Scenario: Valid remote provider configured

- GIVEN `experimental.memory.embedder` is set to a valid provider
- WHEN the embedder is initialized
- THEN the system uses the configured AI SDK remote provider instead of the default local model
