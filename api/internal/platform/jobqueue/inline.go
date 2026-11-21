package jobqueue

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"

	"ffmpeg-go-server/internal/platform/credits"
	"ffmpeg-go-server/internal/platform/sessions"
	"ffmpeg-go-server/internal/platform/storage"
	"github.com/gofiber/fiber/v2"
)

const maxCompileReceipts = 1024

var inlineCompileSlot = make(chan struct{}, 1)

type compileReceipt struct {
	Fingerprint string `json:"fingerprint"`
	Result      Result `json:"result"`
}

func InlineCompile(c *fiber.Ctx, task Task) error {
	submission, err := newSubmission(c, "scene-compile", false)
	if err != nil {
		return err
	}
	if !storage.ValidUserID(submission.Owner) || !sessions.Valid(submission.Session) {
		return fiber.ErrBadRequest
	}
	submission.ID = submission.IdempotencyKey[:32]
	submission.Input.Payload = submission.ID
	dir := filepath.Join(storage.DataDir, ".compile-receipts", submission.Owner, submission.Session)
	path := filepath.Join(dir, submission.IdempotencyKey+".json")
	select {
	case inlineCompileSlot <- struct{}{}:
		defer func() { <-inlineCompileSlot }()
	default:
		return fiber.NewError(429, "Scene compilation is busy. Retry the same free request shortly; no render or generation was started.")
	}
	data, err := os.ReadFile(path)
	if err == nil {
		var receipt compileReceipt
		if json.Unmarshal(data, &receipt) != nil {
			return fiber.NewError(503, "Compilation receipt could not be read.")
		}
		if receipt.Fingerprint != submission.Fingerprint {
			return fiber.NewError(409, "Idempotency key belongs to a different compilation.")
		}
		return sendCompileResult(c, receipt.Result)
	}
	if !errors.Is(err, os.ErrNotExist) {
		return storeError(err)
	}
	entries, err := os.ReadDir(dir)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return storeError(err)
	}
	if len(entries) >= maxCompileReceipts {
		return fiber.NewError(429, "Compilation receipt limit reached for this project.")
	}
	if err := savePayload(submission.ID, c.Body()); err != nil {
		return storeError(err)
	}
	defer removePayload(submission.ID)
	release := sessions.UseWorkspace(submission.Session)
	defer release()
	ctx := credits.WithWorkflowPolicy(c.UserContext(), credits.MCPFree)
	ctx = contextWithJobIdentity(ctx, submission.ID)
	result := task(ctx, submission)
	if result.StatusCode >= 200 && result.StatusCode < 300 {
		encoded, err := json.Marshal(compileReceipt{Fingerprint: submission.Fingerprint, Result: result})
		if err != nil {
			return storeError(err)
		}
		if err := os.MkdirAll(dir, 0700); err != nil {
			return storeError(err)
		}
		file, err := os.CreateTemp(dir, ".receipt-*")
		if err != nil {
			return storeError(err)
		}
		defer os.Remove(file.Name())
		_, writeErr := file.Write(encoded)
		syncErr := file.Sync()
		closeErr := file.Close()
		if err := errors.Join(writeErr, syncErr, closeErr); err != nil {
			return storeError(err)
		}
		if err := os.Rename(file.Name(), path); err != nil {
			return storeError(err)
		}
	}
	return sendCompileResult(c, result)
}

func sendCompileResult(c *fiber.Ctx, result Result) error {
	c.Set(fiber.HeaderCacheControl, "no-store")
	c.Set(fiber.HeaderContentType, result.ContentType)
	return c.Status(result.StatusCode).Send(result.Body)
}
