package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
)

const apiKeyCollection = "direction_api_keys"

var errKeyUnavailable = errors.New("API key service unavailable")

type APIKeyRecord struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Prefix  string `json:"prefix"`
	Created string `json:"created"`
	Owner   string `json:"owner"`
	Hash    string `json:"hash"`
	Revoked bool   `json:"revoked"`
}

type keyRepository interface {
	List(context.Context, string) ([]APIKeyRecord, error)
	Create(context.Context, APIKeyRecord) (APIKeyRecord, error)
	Find(context.Context, string) (APIKeyRecord, error)
	Revoke(context.Context, string, string) error
}

type pocketBaseKeys struct {
	base   string
	token  string
	client *http.Client
}

func keyStoreFromEnv() pocketBaseKeys {
	return pocketBaseKeys{base: baseURL(), token: strings.TrimSpace(os.Getenv("PB_SERVICE_TOKEN")), client: httpClient}
}

func (s pocketBaseKeys) request(ctx context.Context, method, path string, input, output any) error {
	if s.base == "" || s.token == "" {
		return errKeyUnavailable
	}
	var body io.Reader
	if input != nil {
		data, err := json.Marshal(input)
		if err != nil {
			return fmt.Errorf("encode API key request: %w", err)
		}
		body = bytes.NewReader(data)
	}
	req, err := http.NewRequestWithContext(ctx, method, s.base+"/api/collections/"+apiKeyCollection+"/records"+path, body)
	if err != nil {
		return fmt.Errorf("build API key request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+s.token)
	req.Header.Set("Content-Type", "application/json")
	response, err := s.client.Do(req)
	if err != nil {
		return fmt.Errorf("request API key store: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNotFound {
		if strings.HasPrefix(path, "/") {
			return errInvalidAPIKey
		}
		return errKeyUnavailable
	}
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return errKeyUnavailable
	}
	if output == nil {
		return nil
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(output); err != nil {
		return fmt.Errorf("decode API key response: %w", err)
	}
	return nil
}

func (s pocketBaseKeys) records(ctx context.Context, filter string) ([]APIKeyRecord, error) {
	query := url.Values{"filter": {filter}, "perPage": {"100"}, "sort": {"-created"}}
	var result struct {
		Items []APIKeyRecord `json:"items"`
	}
	if err := s.request(ctx, http.MethodGet, "?"+query.Encode(), nil, &result); err != nil {
		return nil, err
	}
	return result.Items, nil
}

func (s pocketBaseKeys) List(ctx context.Context, owner string) ([]APIKeyRecord, error) {
	return s.records(ctx, "owner = "+quoteForFilter(owner)+" && revoked = false")
}

func (s pocketBaseKeys) Create(ctx context.Context, key APIKeyRecord) (APIKeyRecord, error) {
	var result APIKeyRecord
	input := map[string]any{"owner": key.Owner, "name": key.Name, "hash": key.Hash, "prefix": key.Prefix, "revoked": false}
	err := s.request(ctx, http.MethodPost, "", input, &result)
	return result, err
}

func (s pocketBaseKeys) Find(ctx context.Context, hash string) (APIKeyRecord, error) {
	items, err := s.records(ctx, "hash = "+quoteForFilter(hash)+" && revoked = false")
	if err != nil {
		return APIKeyRecord{}, err
	}
	if len(items) != 1 {
		return APIKeyRecord{}, errInvalidAPIKey
	}
	return items[0], nil
}

func (s pocketBaseKeys) Revoke(ctx context.Context, owner, id string) error {
	var record APIKeyRecord
	if err := s.request(ctx, http.MethodGet, "/"+url.PathEscape(id), nil, &record); err != nil {
		return err
	}
	if record.Owner != owner {
		return errInvalidAPIKey
	}
	return s.request(ctx, http.MethodPatch, "/"+url.PathEscape(id), map[string]bool{"revoked": true}, nil)
}
