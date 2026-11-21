package scenecontract

import _ "embed"

// Guide is shared by MCP discovery and the scene model to prevent API drift.
//
//go:embed runtime.md
var Guide string
