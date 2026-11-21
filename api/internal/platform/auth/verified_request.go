package auth

import (
	"context"
	"crypto/subtle"

	"github.com/gofiber/fiber/v2"
)

type verifiedAPIKeyContext struct{}

type verifiedAPIKey struct {
	verifier *APIKeys
	hash     string
	owner    string
	id       string
	user     map[string]any
}

func (verified verifiedAPIKey) apply(c *fiber.Ctx) {
	c.Locals("pbUserId", verified.owner)
	c.Locals("pbUserRecord", verified.user)
	c.Locals("machinalAPIKey", verified.id)
}

func (keys *APIKeys) reuseVerifiedRequest(c *fiber.Ctx, token string) bool {
	verified, ok := c.UserContext().Value(verifiedAPIKeyContext{}).(verifiedAPIKey)
	if !ok || verified.verifier != keys || subtle.ConstantTimeCompare([]byte(verified.hash), []byte(tokenHash(token))) != 1 {
		return false
	}
	verified.apply(c)
	return true
}

func (keys *APIKeys) verifyRequest(c *fiber.Ctx, record APIKeyRecord, user map[string]any) {
	verified := verifiedAPIKey{verifier: keys, hash: record.Hash, owner: record.Owner, id: record.ID, user: user}
	verified.apply(c)
	// Only this request's in-process dispatch can inherit the verified principal;
	// client headers and later HTTP requests must still recheck revocation/access.
	c.SetUserContext(context.WithValue(c.UserContext(), verifiedAPIKeyContext{}, verified))
}
