package mcpserver

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"ffmpeg-go-server/internal/platform/jobqueue"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type jobInput struct {
	ProjectID string `json:"projectId"`
	JobID     string `json:"jobId" jsonschema:"ID returned by compile_scene, render_video, generate_assets or list_jobs"`
}

type jobStatusInput struct {
	jobInput
	WaitSeconds   int  `json:"waitSeconds,omitempty" jsonschema:"Wait on the server for a status change, 0-25 seconds. Prefer 25 to local sleep loops."`
	AfterRevision int  `json:"afterRevision,omitempty" jsonschema:"Last observed job revision"`
	IncludeResult bool `json:"includeResult,omitempty" jsonschema:"Legacy full JSON result; normally use get_job_result once for reusable YAML instead"`
}

type jobWaitInput struct {
	jobInput
	TimeoutSeconds int `json:"timeoutSeconds,omitempty" jsonschema:"Maximum server-side wait, 1-120 seconds; default 120. Heartbeats and progress revisions do not end the wait."`
}

func registerJobTools(server *mcp.Server, call Caller) {
	mcp.AddTool(server, &mcp.Tool{Name: "list_jobs", Description: "Recover compact recent job summaries for an owned project after reconnecting. Results are retained for 30 days.", Annotations: annotations(true, false, true)},
		func(ctx context.Context, req *mcp.CallToolRequest, input projectInput) (*mcp.CallToolResult, Output, error) {
			path, err := projectPath(input.ProjectID, "/jobs?view=summary")
			if err != nil {
				return nil, Output{}, err
			}
			return invoke(ctx, req, call, Request{Method: http.MethodGet, Path: path})
		})
	mcp.AddTool(server, &mcp.Tool{Name: "get_job", Description: "Read a compact progress snapshot. For waiting during generation/rendering prefer wait_for_job, which ignores heartbeat revisions. A successful lookup is not job success. Retrieve get_job_result once after completion for reusable YAML.", Annotations: annotations(true, false, true)},
		func(ctx context.Context, req *mcp.CallToolRequest, input jobStatusInput) (*mcp.CallToolResult, Output, error) {
			path, err := jobStatusPath(input)
			if err != nil {
				return nil, Output{}, err
			}
			return invoke(ctx, req, call, Request{Method: http.MethodGet, Path: path})
		})
	mcp.AddTool(server, &mcp.Tool{Name: "wait_for_job", Description: "Wait on the server for completion, failure or cancellation, up to 120 seconds per call. Ignores heartbeat/progress revisions and returns one compact latest summary, never a composition. Prefer this to repeated get_job calls or local polling scripts. If still running, call again for the SAME job; never submit another render. A successful lookup is not job success: inspect status.", Annotations: annotations(true, false, true)},
		func(ctx context.Context, req *mcp.CallToolRequest, input jobWaitInput) (*mcp.CallToolResult, Output, error) {
			path, err := jobWaitPath(input)
			if err != nil {
				return nil, Output{}, err
			}
			return invoke(ctx, req, call, Request{Method: http.MethodGet, Path: path})
		})
	mcp.AddTool(server, &mcp.Tool{Name: "get_job_result", Description: "Retrieve a job result once. Generation results include a complete resolved recipeYaml with pinned assets, ready to save as .edit.yaml without retranscribing JSON. For unchanged continuation pass sourceJobId to render_video or generate_assets instead of resending the recipe.", Annotations: annotations(true, false, true)},
		func(ctx context.Context, req *mcp.CallToolRequest, input jobInput) (*mcp.CallToolResult, Output, error) {
			result, output, err := invokeJobResult(ctx, req, call, input)
			if err != nil || result.IsError {
				return result, output, err
			}
			output.Data = yamlJobResult(output.Data)
			return result, output, nil
		})
	mcp.AddTool(server, &mcp.Tool{Name: "cancel_job", Description: "Cancel queued work or request cancellation of running work in an owned project. Provider cancellation is best-effort; consumed work may still be billed.", Annotations: annotations(false, true, true)},
		func(ctx context.Context, req *mcp.CallToolRequest, input jobInput) (*mcp.CallToolResult, Output, error) {
			path, err := jobPath(input.ProjectID, input.JobID)
			if err != nil {
				return nil, Output{}, err
			}
			return invoke(ctx, req, call, Request{Method: http.MethodDelete, Path: path})
		})
}

func jobWaitPath(input jobWaitInput) (string, error) {
	path, err := jobPath(input.ProjectID, input.JobID)
	if err != nil {
		return "", err
	}
	maximum := int(jobqueue.MaxCompletionWait / time.Second)
	if input.TimeoutSeconds == 0 {
		input.TimeoutSeconds = maximum
	}
	if input.TimeoutSeconds < 1 || input.TimeoutSeconds > maximum {
		return "", fmt.Errorf("timeoutSeconds must be 1-%d", maximum)
	}
	return path + "?until=terminal&view=summary&wait=" + strconv.Itoa(input.TimeoutSeconds), nil
}

func jobStatusPath(input jobStatusInput) (string, error) {
	path, err := jobPath(input.ProjectID, input.JobID)
	if err != nil {
		return "", err
	}
	if input.WaitSeconds < 0 || input.WaitSeconds > 25 || input.AfterRevision < 0 {
		return "", fmt.Errorf("waitSeconds must be 0-25 and afterRevision must be nonnegative")
	}
	query := url.Values{}
	if !input.IncludeResult {
		query.Set("view", "summary")
	}
	if input.WaitSeconds > 0 {
		query.Set("wait", strconv.Itoa(input.WaitSeconds))
		query.Set("afterRevision", strconv.Itoa(input.AfterRevision))
	}
	if encoded := query.Encode(); encoded != "" {
		path += "?" + encoded
	}
	return path, nil
}
