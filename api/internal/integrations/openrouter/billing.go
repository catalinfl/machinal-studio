package openrouter

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"ffmpeg-go-server/internal/platform/credits"
)

func (c Client) recordUsage(ctx context.Context, attempt string, raw []byte, status int, headers http.Header) error {
	if attempt == "" {
		return nil
	}
	var result struct {
		ID    string `json:"id"`
		Usage struct {
			Cost *json.Number `json:"cost"`
		} `json:"usage"`
	}
	// Audio payloads are binary; their generation ID is carried in the headers.
	if len(raw) > 0 && raw[0] == '{' {
		_ = json.Unmarshal(raw, &result)
	}
	if result.ID == "" {
		result.ID = strings.TrimSpace(headers.Get("X-Generation-Id"))
	}
	if result.ID != "" {
		meter := credits.FromContext(ctx)
		if err := meter.Store.NoteGeneration(meter.Owner, meter.ID, attempt, result.ID); err != nil {
			return err
		}
	}
	if result.Usage.Cost != nil {
		return credits.ResolveProvider(ctx, attempt, result.ID, result.Usage.Cost.String())
	}
	if status < 200 || status >= 300 {
		return credits.ResolveProvider(ctx, attempt, "", "0")
	}
	if credits.FromContext(ctx).DeferredUsage {
		return nil
	}
	if result.ID == "" {
		return fmt.Errorf("provider did not report billable usage; actual cost is pending reconciliation")
	}
	cost, err := c.generationCost(ctx, result.ID)
	if err != nil {
		return err
	}
	return credits.ResolveProvider(ctx, attempt, result.ID, cost)
}

func (c Client) ReconcileUsage(ctx context.Context) error {
	meter := credits.FromContext(ctx)
	if meter == nil {
		return nil
	}
	pending, err := meter.Store.Operation(meter.Owner, meter.ID)
	if err != nil {
		return err
	}
	if pending == nil || pending.ID != meter.ID {
		return credits.ErrNotFound
	}
	for attempt := range pending.Attempts {
		generation := pending.Generations[attempt]
		if generation == "" {
			return credits.ErrPending
		}
		cost, err := c.generationCost(ctx, generation)
		if err != nil {
			return err
		}
		if err := credits.ResolveProvider(ctx, attempt, generation, cost); err != nil {
			return err
		}
	}
	return nil
}

func (c Client) generationCost(ctx context.Context, id string) (string, error) {
	for attempt := 0; attempt < 3; attempt++ {
		cost, err := c.fetchGenerationCost(ctx, id)
		if err == nil {
			return cost, nil
		}
		if attempt < 2 && !sleepContext(ctx, 300*time.Millisecond) {
			return "", ctx.Err()
		}
	}
	return "", fmt.Errorf("provider cost is unavailable; actual cost is pending reconciliation")
}

func (c Client) fetchGenerationCost(ctx context.Context, id string) (string, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL()+"/generation?id="+url.QueryEscape(id), nil)
	if err != nil {
		return "", fmt.Errorf("build provider usage request: %w", err)
	}
	request.Header.Set("Authorization", "Bearer "+c.APIKey)
	response, err := c.httpClient().Do(request)
	if err != nil {
		return "", fmt.Errorf("read provider usage: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return "", fmt.Errorf("provider usage unavailable")
	}
	raw, err := readLimited(response.Body, maxChatResponseBody, "provider usage")
	if err != nil {
		return "", err
	}
	var result struct {
		Data struct {
			ID   string       `json:"id"`
			Cost *json.Number `json:"total_cost"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		return "", fmt.Errorf("decode provider usage: %w", err)
	}
	if result.Data.ID != id || result.Data.Cost == nil {
		return "", fmt.Errorf("provider usage is not ready")
	}
	return result.Data.Cost.String(), nil
}

func (c Client) Do(request *http.Request, limit int64, description string) ([]byte, int, http.Header, error) {
	return c.do(request, limit, description)
}
