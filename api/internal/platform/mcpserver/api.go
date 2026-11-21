package mcpserver

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"

	"ffmpeg-go-server/internal/core/editor/compositions"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

var (
	projectIDPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)
	jobIDPattern     = regexp.MustCompile(`^[a-f0-9]{32}$`)
)

func projectPath(id, suffix string) (string, error) {
	if !projectIDPattern.MatchString(id) {
		return "", errors.New("Use a projectId returned by list_projects or create_project.")
	}
	return "/v1/projects/" + id + suffix, nil
}

func jobPath(projectID, jobID string) (string, error) {
	if !jobIDPattern.MatchString(jobID) {
		return "", errors.New("Use a jobId returned by render_video, generate_assets or list_jobs.")
	}
	return projectPath(projectID, "/jobs/"+jobID)
}

func invoke(ctx context.Context, req *mcp.CallToolRequest, call Caller, operation Request) (*mcp.CallToolResult, Output, error) {
	headers := make(http.Header)
	if req.Extra != nil {
		headers = req.Extra.Header
	}
	response, err := call(ctx, headers, operation)
	if errors.Is(err, ErrResultTooLarge) {
		return nil, Output{}, errors.New("The API result is too large for MCP. Retrieve it through the authenticated REST API instead.")
	}
	if err != nil {
		return nil, Output{}, errors.New("The API request could not be completed. For an uncertain submission, retry with the same idempotencyKey and composition.")
	}
	if len(response.Body) > MaxResultBytes {
		return nil, Output{}, errors.New("The API result is too large for MCP. Retrieve it through the authenticated REST API instead.")
	}
	var data any
	if len(response.Body) > 0 {
		if json.Unmarshal(response.Body, &data) != nil {
			data = string(response.Body)
		}
	}
	output := Output{StatusCode: response.StatusCode, Data: data,
		StatusURL: response.Header.Get("Location"), RetryAfter: response.Header.Get("Retry-After")}
	return &mcp.CallToolResult{IsError: response.StatusCode >= http.StatusBadRequest}, output, nil
}

func compositionRequest(projectID, composition, suffix, key string) (Request, error) {
	path, err := projectPath(projectID, suffix)
	if err != nil {
		return Request{}, err
	}
	if strings.TrimSpace(composition) == "" || len(composition) > maxCompositionBytes {
		return Request{}, errors.New("Provide a non-empty YAML composition of at most 2 MiB. Upload source media separately.")
	}
	if _, _, err := compositions.ParseProject([]byte(composition)); err != nil {
		return Request{}, fmt.Errorf("Invalid recipe; no operation was submitted: %w", err)
	}
	return Request{Method: http.MethodPost, Path: path, ContentType: "application/yaml", Body: []byte(strings.ReplaceAll(composition, "\r\n", "\n")), IdempotencyKey: key}, nil
}

func validateIdempotencyKey(key string) error {
	if strings.TrimSpace(key) == "" || len(key) > 128 || strings.ContainsAny(key, "\r\n") {
		return errors.New("Provide a non-empty idempotencyKey of at most 128 characters; reuse it only for retries of this exact operation.")
	}
	return nil
}

func jsonRequest(path string, input any) (Request, error) {
	body, err := json.Marshal(input)
	if err != nil {
		return Request{}, errors.New("The request could not be encoded as JSON.")
	}
	return Request{Method: http.MethodPost, Path: path, ContentType: "application/json", Body: body}, nil
}
