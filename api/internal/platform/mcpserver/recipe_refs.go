package mcpserver

import (
	"context"
	"crypto/sha256"
	"errors"
	"sync"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const recipeRefTTL = 30 * time.Minute
const maxRecipeRefs = 32 // at most 64 MiB of bounded recipe bodies per handler

type recipeKey struct {
	credential   [32]byte
	project, ref string
}
type recipeEntry struct {
	yaml    string
	expires time.Time
}
type recipeRefs struct {
	sync.Mutex
	entries map[recipeKey]recipeEntry
}

func refKey(req *mcp.CallToolRequest, project, ref string) (recipeKey, bool) {
	if req.Extra == nil || req.Extra.Header.Get("Authorization") == "" {
		return recipeKey{}, false
	}
	return recipeKey{sha256.Sum256([]byte(req.Extra.Header.Get("Authorization"))), project, ref}, true
}

func (r *recipeRefs) save(req *mcp.CallToolRequest, project, yaml string) string {
	ref := compositionVersion(yaml)
	key, ok := refKey(req, project, ref)
	if !ok {
		return ""
	}
	r.Lock()
	defer r.Unlock()
	now := time.Now()
	var oldest recipeKey
	for k, e := range r.entries {
		if !now.Before(e.expires) {
			delete(r.entries, k)
		} else if oldest.ref == "" || e.expires.Before(r.entries[oldest].expires) {
			oldest = k
		}
	}
	if _, exists := r.entries[key]; !exists && len(r.entries) >= maxRecipeRefs {
		delete(r.entries, oldest)
	}
	r.entries[key] = recipeEntry{yaml, now.Add(recipeRefTTL)}
	return ref
}

func (r *recipeRefs) resolve(ctx context.Context, req *mcp.CallToolRequest, call Caller, project, job, yaml, ref string) (string, error) {
	if ref == "" {
		return continuationYAML(ctx, req, call, project, job, yaml)
	}
	if job != "" || yaml != "" {
		return "", errors.New("Use exactly one of composition, sourceJobId or recipeRef.")
	}
	key, ok := refKey(req, project, ref)
	r.Lock()
	defer r.Unlock()
	if entry, exists := r.entries[key]; ok && exists && time.Now().Before(entry.expires) {
		return entry.yaml, nil
	}
	return "", errors.New("Recipe reference unavailable for this credential/project. Resend the YAML to validate_recipe; no work was submitted.")
}
