package compositions

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"ffmpeg-go-server/editengine/catalog"
	"ffmpeg-go-server/editengine/compiler"
	"ffmpeg-go-server/editengine/composition"
	"ffmpeg-go-server/editengine/document"
	"ffmpeg-go-server/editengine/text"

	"github.com/gofiber/fiber/v2"
)

type Request struct {
	Document     json.RawMessage       `json:"document"`
	Recipe       json.RawMessage       `json:"recipe,omitempty"`
	Bindings     document.Bindings     `json:"bindings"`
	Assets       []document.Asset      `json:"assets"`
	Snapshot     *composition.Snapshot `json:"snapshot,omitempty"`
	PreparedText *text.Prepared        `json:"preparedText,omitempty"`
}

var engine = compiler.New()

func ParseRequest(body []byte) (compiler.Input, document.Parsed, error) {
	var request Request
	if len(body) > document.MaxProjectBytes {
		return compiler.Input{}, document.Parsed{}, fmt.Errorf("composition request exceeds %d bytes", document.MaxProjectBytes)
	}
	if err := document.DecodeJSON(body, &request); err != nil {
		return compiler.Input{}, document.Parsed{}, fmt.Errorf("invalid request: %w", err)
	}
	data := request.Document
	if len(data) > 0 && data[0] == '"' {
		var yaml string
		if err := json.Unmarshal(data, &yaml); err != nil {
			return compiler.Input{}, document.Parsed{}, err
		}
		data = []byte(yaml)
	}
	parsed, err := document.Parse(data)
	return compiler.Input{Document: parsed.Document, Bindings: request.Bindings, Assets: request.Assets, Snapshot: request.Snapshot, PreparedText: request.PreparedText}, parsed, err
}

func ParseProject(source []byte) (compiler.Input, document.Parsed, error) {
	data, err := document.ProjectJSON(source)
	if err != nil {
		return compiler.Input{}, document.Parsed{}, err
	}
	var fields map[string]json.RawMessage
	if err := document.DecodeJSON(data, &fields); err != nil {
		return compiler.Input{}, document.Parsed{}, fmt.Errorf("decode project: %w", err)
	}
	if _, ok := fields["document"]; ok {
		return ParseRequest(data)
	}
	parsed, err := document.Parse(source)
	return compiler.Input{Document: parsed.Document}, parsed, err
}

func Compile(c *fiber.Ctx) error {
	input, parsed, err := ParseProject(c.Body())
	if err != nil {
		return parseError(c, err)
	}
	if c.QueryBool("draft") {
		return sendResult(c, WithPositions(engine.CompileDraft(input), parsed))
	}
	return sendResult(c, WithPositions(engine.Compile(input), parsed))
}

func Validate(c *fiber.Ctx) error {
	input, parsed, err := ParseProject(c.Body())
	if err != nil {
		return parseError(c, err)
	}
	return sendResult(c, WithPositions(engine.Validate(input), parsed))
}

func Capabilities(c *fiber.Ctx) error {
	schema, err := json.Marshal(document.Schema())
	if err != nil {
		return fiber.ErrInternalServerError
	}
	digest := sha256.Sum256(schema)
	result := fiber.Map{"dslVersion": document.MontageVersion, "compilerVersion": compiler.Version, "catalogVersion": catalog.Version, "schemaHash": hex.EncodeToString(digest[:]),
		"recipeFormat": "yaml", "textAnchors": []string{"left", "center", "right"},
		"generation": generationCapabilities(),
		"limits":     fiber.Map{"clips": compiler.MaxClips, "textItems": compiler.MaxTextItems, "commands": compiler.MaxCommands}}
	if !c.QueryBool("summary") {
		result["catalog"], result["commands"] = catalog.JSON(), compiler.SupportedCommands()
	}
	return c.JSON(result)
}

func Schema(c *fiber.Ctx) error { return c.JSON(document.Schema()) }

func WithPositions(result composition.Result, parsed document.Parsed) composition.Result {
	for index := range result.Diagnostics {
		diagnostic := &result.Diagnostics[index]
		path := diagnostic.Path
		for path != "" {
			if position, ok := parsed.Positions[path]; ok {
				diagnostic.Line, diagnostic.Column = position.Line, position.Column
				break
			}
			last := strings.LastIndexAny(path, ".[ ")
			if last < 0 {
				break
			}
			path = path[:last]
		}
	}
	return result
}

func parseError(c *fiber.Ctx, err error) error {
	diagnostic := document.Diagnostic{Code: "parse", Severity: "error", Path: "document", Message: err.Error()}
	var positioned document.Diagnostic
	if errors.As(err, &positioned) {
		diagnostic = positioned
	}
	return c.Status(fiber.StatusBadRequest).JSON(composition.Result{Diagnostics: []document.Diagnostic{diagnostic}, Requirements: []composition.Requirement{}})
}

func HasErrors(result composition.Result) bool {
	for _, diagnostic := range result.Diagnostics {
		if diagnostic.Severity == "error" {
			return true
		}
	}
	return false
}

func sendResult(c *fiber.Ctx, result composition.Result) error {
	if HasErrors(result) {
		c.Status(fiber.StatusUnprocessableEntity)
	}
	return c.JSON(result)
}
