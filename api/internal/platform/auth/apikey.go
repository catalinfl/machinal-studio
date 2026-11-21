package auth

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"unicode/utf8"

	"ffmpeg-go-server/internal/platform/sessions"

	"github.com/gofiber/fiber/v2"
)

const (
	apiKeyPrefix    = "mach_"
	legacyKeyPrefix = "dal_"
	apiKeyBytes     = 32
	maxAPIKeys      = 10
	maxKeyNameRunes = 80
	maxKeyBodyBytes = 4 << 10
	keyPrefixLength = 12
)

var errInvalidAPIKey = errors.New("invalid API key")

type APIKeys struct {
	store  func() keyRepository
	access func(context.Context, string) (map[string]any, bool, error)
	mu     sync.Mutex
}

func NewAPIKeys() *APIKeys {
	return &APIKeys{store: func() keyRepository { return keyStoreFromEnv() }, access: apiKeyPaidAccess}
}

type apiKeySummary struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Prefix  string `json:"prefix"`
	Created string `json:"created"`
}

func summarizeKey(key APIKeyRecord) apiKeySummary {
	return apiKeySummary{ID: key.ID, Name: key.Name, Prefix: key.Prefix, Created: key.Created}
}

func (keys *APIKeys) List(c *fiber.Ctx) error {
	c.Set("Cache-Control", "no-store")
	items, err := keys.store().List(c.UserContext(), UserID(c))
	if err != nil {
		return fiber.NewError(fiber.StatusServiceUnavailable, "API keys are not available. Please retry.")
	}
	summaries := make([]apiKeySummary, 0, len(items))
	for _, item := range items {
		summaries = append(summaries, summarizeKey(item))
	}
	return c.JSON(summaries)
}

func (keys *APIKeys) Create(c *fiber.Ctx) error {
	c.Set("Cache-Control", "no-store")
	name, err := parseKeyName(c.Body())
	if err != nil {
		return err
	}
	_, paid, err := keys.access(c.UserContext(), UserID(c))
	if err != nil {
		return fiber.NewError(fiber.StatusServiceUnavailable, "Subscription verification is unavailable.")
	}
	if !paid {
		return fiber.NewError(fiber.StatusPaymentRequired, PaidPlanRequiredMessage)
	}
	key, token, err := keys.issue(c.UserContext(), UserID(c), name)
	if err != nil {
		return err
	}
	return c.Status(fiber.StatusCreated).JSON(struct {
		apiKeySummary
		Key string `json:"key"`
	}{apiKeySummary: summarizeKey(key), Key: token})
}

func parseKeyName(body []byte) (string, error) {
	var input struct {
		Name string `json:"name"`
	}
	message := fmt.Sprintf("Enter a key name of 1–%d characters.", maxKeyNameRunes)
	if len(body) > maxKeyBodyBytes || json.Unmarshal(body, &input) != nil {
		return "", fiber.NewError(fiber.StatusBadRequest, message)
	}
	name := strings.TrimSpace(input.Name)
	if name == "" || utf8.RuneCountInString(name) > maxKeyNameRunes {
		return "", fiber.NewError(fiber.StatusBadRequest, message)
	}
	return name, nil
}

func (keys *APIKeys) issue(ctx context.Context, owner, name string) (APIKeyRecord, string, error) {
	keys.mu.Lock()
	defer keys.mu.Unlock()
	store := keys.store()
	items, err := store.List(ctx, owner)
	if err != nil {
		return APIKeyRecord{}, "", fiber.NewError(fiber.StatusServiceUnavailable, "API keys are not available. Please retry.")
	}
	if len(items) >= maxAPIKeys {
		return APIKeyRecord{}, "", fiber.NewError(fiber.StatusConflict, fmt.Sprintf("Revoke an existing key before creating another (maximum %d).", maxAPIKeys))
	}
	var secret [apiKeyBytes]byte
	if _, err := rand.Read(secret[:]); err != nil {
		return APIKeyRecord{}, "", fiber.NewError(fiber.StatusInternalServerError, "Could not create an API key.")
	}
	token := apiKeyPrefix + hex.EncodeToString(secret[:])
	key, err := store.Create(ctx, APIKeyRecord{Owner: owner, Name: name, Hash: tokenHash(token), Prefix: token[:keyPrefixLength]})
	if err != nil {
		return APIKeyRecord{}, "", fiber.NewError(fiber.StatusServiceUnavailable, "Could not save the API key. Please retry.")
	}
	return key, token, nil
}

func (keys *APIKeys) Revoke(c *fiber.Ctx) error {
	c.Set("Cache-Control", "no-store")
	if !sessions.Valid(c.Params("keyID")) {
		return fiber.ErrNotFound
	}
	if err := keys.store().Revoke(c.UserContext(), UserID(c), c.Params("keyID")); err != nil {
		if errors.Is(err, errInvalidAPIKey) {
			return fiber.ErrNotFound
		}
		return fiber.NewError(fiber.StatusServiceUnavailable, "Could not revoke the API key. Please retry.")
	}
	return c.SendStatus(fiber.StatusNoContent)
}

func (keys *APIKeys) Require(c *fiber.Ctx) error {
	c.Set("Cache-Control", "no-store")
	token := bearer(c.Get(fiber.HeaderAuthorization))
	prefix := apiKeyTokenPrefix(token)
	if prefix == "" {
		return fiber.NewError(fiber.StatusUnauthorized, "A machinal API key is required.")
	}
	if _, err := hex.DecodeString(token[len(prefix):]); err != nil {
		return fiber.ErrUnauthorized
	}
	hash := tokenHash(token)
	record, err := keys.store().Find(c.UserContext(), hash)
	if errors.Is(err, errInvalidAPIKey) {
		return fiber.NewError(fiber.StatusUnauthorized, "The API key is invalid or revoked.")
	}
	if err != nil {
		return fiber.NewError(fiber.StatusServiceUnavailable, "API key verification is unavailable.")
	}
	if record.Revoked || record.Owner == "" || subtle.ConstantTimeCompare([]byte(record.Hash), []byte(hash)) != 1 {
		return fiber.ErrUnauthorized
	}
	user, paid, err := keys.access(c.UserContext(), record.Owner)
	if err != nil {
		return fiber.NewError(fiber.StatusServiceUnavailable, "Subscription verification is unavailable.")
	}
	if !paid {
		return fiber.NewError(fiber.StatusPaymentRequired, PaidPlanRequiredMessage)
	}
	c.Locals("pbUserId", record.Owner)
	c.Locals("pbUserRecord", user)
	c.Locals("machinalAPIKey", record.ID)
	return c.Next()
}

func apiKeyTokenPrefix(token string) string {
	for _, prefix := range []string{apiKeyPrefix, legacyKeyPrefix} {
		if len(token) == len(prefix)+hex.EncodedLen(apiKeyBytes) && strings.HasPrefix(token, prefix) {
			return prefix
		}
	}
	return ""
}

func CurrentPaidAccess(ctx context.Context, owner string) (bool, error) {
	_, paid, err := apiKeyPaidAccess(ctx, owner)
	return paid, err
}

func apiKeyPaidAccess(ctx context.Context, owner string) (map[string]any, bool, error) {
	store := keyStoreFromEnv()
	if store.base == "" || store.token == "" {
		return nil, false, errKeyUnavailable
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, store.base+"/api/collections/users/records/"+url.PathEscape(owner), nil)
	if err != nil {
		return nil, false, err
	}
	req.Header.Set("Authorization", "Bearer "+store.token)
	response, err := store.client.Do(req)
	if err != nil {
		return nil, false, err
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNotFound {
		return nil, false, nil
	}
	if response.StatusCode != http.StatusOK {
		return nil, false, errKeyUnavailable
	}
	var record map[string]any
	if err := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&record); err != nil {
		return nil, false, err
	}
	if idOf(record) != owner {
		return nil, false, errKeyUnavailable
	}
	if paid, err := localMembershipAccess(owner); err != nil || paid {
		return record, paid, err
	}
	if recordHasPaidAccess(record) {
		return record, true, nil
	}
	paid, err := hasPaidSubscription(owner, store.token)
	return record, paid, err
}
