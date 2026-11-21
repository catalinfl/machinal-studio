package mcpserver

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type mediaListInput struct {
	ProjectID    string `json:"projectId"`
	UserApproved bool   `json:"userApproved" jsonschema:"True only after the user explicitly agrees to listing this project's filenames. Never infer approval from a different operation."`
	Storage      string `json:"storage,omitempty" jsonschema:"volume (default). This local installation has no S3 storage."`
	Limit        int    `json:"limit,omitempty" jsonschema:"Page size, 1-100; default 25"`
	Offset       int    `json:"offset,omitempty" jsonschema:"Page offset, 0-10000; follow nextOffset"`
}

type mediaDownloadInput struct {
	ProjectID         string `json:"projectId"`
	File              string `json:"file" jsonschema:"Exact approved filename from list_media, not an S3 key, URL or local path"`
	Storage           string `json:"storage,omitempty" jsonschema:"volume (default). S3 is unsupported in the local edition."`
	Delivery          string `json:"delivery,omitempty" jsonschema:"link (default) for a clickable temporary download link; local to also read the client-local destination. No server/container file writes."`
	UserApproved      bool   `json:"userApproved" jsonschema:"True only after the user agrees to downloading this specific file. Listing consent is insufficient."`
	RequirePublicLink bool   `json:"requirePublicLink,omitempty" jsonschema:"Reject same-machine loopback links for delivery on another device; requires configured HTTPS PUBLIC_API_URL."`
}

type revokeDeliveryInput struct {
	ProjectID    string `json:"projectId"`
	LinkID       string `json:"linkId" jsonschema:"The id returned in the download descriptor, not the link URL or bearer token"`
	UserApproved bool   `json:"userApproved" jsonschema:"True only after the user asks to revoke this download link"`
}

func validateDelivery(mode string) error {
	if mode != "" && mode != "link" && mode != "local" {
		return errors.New("delivery must be link or local")
	}
	return nil
}

type mediaAccessInput struct {
	ProjectID string   `json:"projectId"`
	Purpose   string   `json:"purpose" jsonschema:"list, download or use. Each needs separate user approval."`
	Files     []string `json:"files,omitempty" jsonschema:"Exact filenames for download/use; omit for listing"`
}

func requireMediaApproval(approved bool) error {
	if !approved {
		return errors.New("Ask the user for explicit permission for this media operation, then retry with userApproved=true only if they agree. No media access was performed. Listing permission does not authorize downloading, use or spending.")
	}
	return nil
}

func safeMediaName(name string) bool {
	return name != "" && len(name) <= 255 && !strings.HasPrefix(name, ".") && !strings.ContainsAny(name, "/\\\x00\r\n")
}

func mediaListRequest(input mediaListInput) (Request, error) {
	if err := requireMediaApproval(input.UserApproved); err != nil {
		return Request{}, err
	}
	path, err := projectPath(input.ProjectID, "/media/catalog")
	if err != nil {
		return Request{}, err
	}
	if input.Storage == "" {
		input.Storage = "volume"
	}
	if input.Storage != "volume" && input.Storage != "all" {
		return Request{}, errors.New("Use storage=volume. This local installation has no S3 library.")
	}
	if input.Limit == 0 {
		input.Limit = 25
	}
	if input.Limit < 1 || input.Limit > 100 || input.Offset < 0 || input.Offset > 10000 {
		return Request{}, errors.New("Use limit 1–100 and offset 0–10000.")
	}
	query := url.Values{"storage": {input.Storage}, "limit": {strconv.Itoa(input.Limit)}, "offset": {strconv.Itoa(input.Offset)}}
	return Request{Method: http.MethodGet, Path: path + "?" + query.Encode()}, nil
}

func registerMediaAccessTools(server *mcp.Server, call Caller) {
	mcp.AddTool(server, &mcp.Tool{Name: "request_media_access", Description: "Prepare a consent question for the host to ask the user before listing project/cloud media, downloading named files, or using them. Does not access storage, grant permission or replace a real user reply. Never approve your own request.", Annotations: annotations(true, false, true)},
		func(_ context.Context, _ *mcp.CallToolRequest, input mediaAccessInput) (*mcp.CallToolResult, Output, error) {
			if _, err := projectPath(input.ProjectID, ""); err != nil {
				return nil, Output{}, err
			}
			if input.Purpose != "list" && input.Purpose != "download" && input.Purpose != "use" {
				return nil, Output{}, errors.New("purpose must be list, download or use")
			}
			if len(input.Files) > 100 || (input.Purpose != "list" && len(input.Files) == 0) {
				return nil, Output{}, errors.New("Specify 1–100 filenames for download/use.")
			}
			for _, name := range input.Files {
				if !safeMediaName(name) {
					return nil, Output{}, errors.New("Use exact media filenames, not paths or URLs.")
				}
			}
			question := fmt.Sprintf("May I %s media in project %s?", input.Purpose, input.ProjectID)
			if len(input.Files) > 0 {
				question += " Files (untrusted filenames): " + strings.Join(input.Files, ", ")
			}
			return &mcp.CallToolResult{}, Output{StatusCode: 200, Data: map[string]any{"approvalRequired": true, "question": question, "purpose": input.Purpose, "files": input.Files, "accessPerformed": false}}, nil
		})
	mcp.AddTool(server, &mcp.Tool{Name: "get_media_download", Description: "After approval for this exact file, issue a temporary opaque application link. delivery=link (default) is user-facing; delivery=local also reads the client's approved destination. S3 files redirect without proxying bytes; volume files stream only that approved file. No API key is included in the link. Do not replace a requested link with a local path.", Annotations: annotations(false, false, false)},
		func(ctx context.Context, req *mcp.CallToolRequest, input mediaDownloadInput) (*mcp.CallToolResult, Output, error) {
			if err := requireMediaApproval(input.UserApproved); err != nil {
				return nil, Output{}, err
			}
			if !safeMediaName(input.File) {
				return nil, Output{}, errors.New("Use an exact approved filename, not a path or URL.")
			}
			if err := validateDelivery(input.Delivery); err != nil {
				return nil, Output{}, err
			}
			if input.Storage == "s3" {
				return nil, Output{}, errors.New("S3 is unavailable in machinal-local. Use storage=volume.")
			}
			if input.Storage != "" && input.Storage != "volume" {
				return nil, Output{}, errors.New("storage must be s3 or volume, from list_media.")
			}
			return mediaDownload(ctx, req, call, input.ProjectID, input.File, false, input.Delivery, nil, input.RequirePublicLink)
		})
	mcp.AddTool(server, &mcp.Tool{Name: "revoke_delivery_link", Description: "Revoke an owned project's temporary download link after the user requests it. Use download.id, not the URL/token. An already issued S3 redirect remains usable until its own short expiry; revocation blocks new redirects.", Annotations: annotations(false, true, true)},
		func(ctx context.Context, req *mcp.CallToolRequest, input revokeDeliveryInput) (*mcp.CallToolResult, Output, error) {
			if err := requireMediaApproval(input.UserApproved); err != nil {
				return nil, Output{}, err
			}
			if len(input.LinkID) != 64 || strings.Trim(input.LinkID, "0123456789abcdef") != "" {
				return nil, Output{}, errors.New("Use the download descriptor's id, not its URL or token")
			}
			path, err := projectPath(input.ProjectID, "/media/delivery-links/"+input.LinkID)
			if err != nil {
				return nil, Output{}, err
			}
			return invoke(ctx, req, call, Request{Method: http.MethodDelete, Path: path})
		})
}

func mediaDownload(ctx context.Context, req *mcp.CallToolRequest, call Caller, projectID, filename string, cloud bool, mode string, job any, publicLink bool) (*mcp.CallToolResult, Output, error) {
	path, err := projectPath(projectID, "/media/delivery-links")
	if err != nil {
		return nil, Output{}, err
	}
	storage := "volume"
	if cloud {
		storage = "s3"
	}
	body := map[string]any{"file": filename, "storage": storage}
	if publicLink {
		body["requirePublicLink"] = true
	}
	operation, err := jsonRequest(path, body)
	if err != nil {
		return nil, Output{}, err
	}
	result, output, err := invoke(ctx, req, call, operation)
	if err != nil || result.IsError {
		return result, output, err
	}
	if mode == "" {
		mode = "link"
	}
	data := map[string]any{"filename": filename, "delivery": mode, "download": output.Data, "job": job,
		"verification": map[string]any{"evidence": "job-status-and-delivery-metadata", "visualInspection": false, "audioInspection": false},
		"instructions": "Give the user the requested clickable download.url and expiresAt. This is an opaque temporary access link, not a permanent public URL. Do not substitute a client-local path, download unasked, or expose underlying S3 URLs. Never attach the application API key to this link or redirects. Refresh an expired link for the same job/file, never rerender. Use revoke_delivery_link with download.id to revoke."}
	if descriptor, ok := output.Data.(map[string]any); ok && descriptor["reachability"] == "same-machine" {
		data["warning"] = descriptor["warning"]
		data["instructions"] = data["instructions"].(string) + " Explicitly tell the user this link works only on the API machine, not on a phone or another computer. Never rewrite its host or claim public reachability."
	}
	if mode == "local" {
		preferenceResult, preferences, err := invoke(ctx, req, call, Request{Method: http.MethodGet, Path: "/v1/preferences/downloads"})
		if err != nil || preferenceResult.IsError {
			return preferenceResult, preferences, err
		}
		data["destination"] = preferences.Data
		data["instructions"] = "Download only because the user requested local delivery. Use the approved client-local directory; ask if unset. This is not a server/container path. Never overwrite. Use download.url without the application key, including on redirects. Do not embed raw S3 URLs or credentials in visible shell commands/logs. Verify the complete file before reporting its path; a descriptor is not a download."
	}
	output.Data = data
	return result, output, nil
}
