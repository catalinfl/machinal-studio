package auth

import (
	"encoding/json"
	"net/http"
	"net/url"
	"os"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/gofiber/fiber/v2"
)

const PaidPlanRequiredMessage = "paid plan required"

// paidCache short-TTLs subscription verdicts per uid so each /render|/ai/*
// doesn't fan out to 2 more PB GETs. Fail-closed: cache only positive+negative
// verdicts, never errors.
type paidCacheEntry struct {
	paid    bool
	expires time.Time
}

var (
	paidCacheMu sync.Mutex
	paidCache   = map[string]paidCacheEntry{}
)

const paidCacheTTL = 30 * time.Second

func paidCacheGet(uid string) (bool, bool) {
	// Bind to PB base URL so parallel tests with mock servers don't collide.
	key := baseURL() + "\x00" + uid
	paidCacheMu.Lock()
	defer paidCacheMu.Unlock()
	e, ok := paidCache[key]
	if !ok || time.Now().After(e.expires) {
		if ok {
			delete(paidCache, key)
		}
		return false, false
	}
	return e.paid, true
}

func paidCachePut(uid string, paid bool) {
	key := baseURL() + "\x00" + uid
	paidCacheMu.Lock()
	defer paidCacheMu.Unlock()
	if len(paidCache) >= maxAuthCacheEntries {
		now := time.Now()
		for k, v := range paidCache {
			if now.After(v.expires) {
				delete(paidCache, k)
			}
		}
		for key := range paidCache {
			if len(paidCache) < maxAuthCacheEntries {
				break
			}
			delete(paidCache, key)
		}
	}
	paidCache[key] = paidCacheEntry{paid: paid, expires: time.Now().Add(paidCacheTTL)}
}

// RequirePaid gates paid-only routes (server export and AI features) to paid
// users only. Local (browser/WASM) editing stays free, so this middleware is
// wired only into POST /render and POST /ai/*. It runs after RequirePBAuth
// (and RequireOwnedSession where the route needs it).
func RequirePaid(c *fiber.Ctx) error {
	if !paidGateEnabled() {
		return c.Next()
	}
	uid := UserID(c)
	token := bearer(c.Get(fiber.HeaderAuthorization))
	if uid == "" || token == "" {
		return c.Status(fiber.StatusUnauthorized).SendString("login required")
	}
	if paid, err := localMembershipAccess(uid); err != nil {
		return fiber.NewError(fiber.StatusServiceUnavailable, "Membership verification is unavailable.")
	} else if paid {
		return c.Next()
	}

	if recordHasPaidAccess(UserRecord(c)) {
		return c.Next()
	}

	if cached, ok := paidCacheGet(uid); ok {
		if !cached {
			return c.Status(fiber.StatusPaymentRequired).SendString(PaidPlanRequiredMessage)
		}
		return c.Next()
	}

	paid, err := hasPaidSubscription(uid, token)
	if err != nil {
		return c.Status(fiber.StatusBadGateway).SendString("auth service unavailable")
	}
	paidCachePut(uid, paid)
	if !paid {
		return c.Status(fiber.StatusPaymentRequired).SendString(PaidPlanRequiredMessage)
	}
	return c.Next()
}

func paidGateEnabled() bool {
	raw := strings.TrimSpace(os.Getenv("EXPORT_REQUIRE_PAID"))
	if raw == "" {
		return true
	}
	switch strings.ToLower(raw) {
	case "0", "false", "no", "off", "disabled":
		return false
	default:
		return true
	}
}

func paidCollection() string {
	if v := strings.TrimSpace(os.Getenv("PB_PAID_COLLECTION")); v != "" {
		return v
	}
	return "subscriptions"
}

func paidUserField() string {
	if v := strings.TrimSpace(os.Getenv("PB_PAID_USER_FIELD")); v != "" {
		return v
	}
	return "user"
}

func extraPaidPlans() []string {
	var out []string
	for _, p := range strings.Split(os.Getenv("PB_PAID_PLANS"), ",") {
		if p = strings.ToLower(strings.TrimSpace(p)); p != "" {
			out = append(out, p)
		}
	}
	return out
}

const paidSubscriptionFields = "id,status,state,active,isActive,subscribed,isPaid,paid,plan,tier,expiresAt,expires,currentPeriodEnd,periodEnd,user,userId,owner,ownerId"

func hasPaidSubscription(uid, token string) (bool, error) {
	base := baseURL()
	if base == "" {
		return false, nil
	}
	coll := url.PathEscape(paidCollection())

	// 1) Direct lookup: subscription id == user id.
	item, found, err := fetchSubscriptionByID(base, coll, uid, token)
	if err != nil {
		return false, err
	}
	if found {
		return subscriptionRecordGrantsAccess(item), nil
	}

	// 2) Relation lookup: rows pointing at the user.
	return fetchSubscriptionByUserField(base, coll, uid, token)
}

func pbAuthorizedGet(endpoint, token string) (*http.Response, error) {
	req, err := http.NewRequest(http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	return httpClient.Do(req)
}

func fetchSubscriptionByID(base, coll, uid, token string) (map[string]any, bool, error) {
	endpoint := base + "/api/collections/" + coll + "/records/" + url.PathEscape(uid) + "?fields=" + url.QueryEscape(paidSubscriptionFields)
	resp, err := pbAuthorizedGet(endpoint, token)
	if err != nil {
		return nil, false, err
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
	case http.StatusOK:
	case http.StatusNotFound:
		return nil, false, nil
	case http.StatusBadRequest, http.StatusUnauthorized, http.StatusForbidden:
		return nil, false, nil
	default:
		return nil, false, errUpstream(resp.StatusCode)
	}

	var item map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&item); err != nil {
		return nil, false, err
	}
	return item, true, nil
}

func fetchSubscriptionByUserField(base, coll, uid, token string) (bool, error) {
	filter := paidUserField() + " = " + quoteForFilter(uid)
	query := url.Values{}
	query.Set("filter", filter)
	query.Set("perPage", "5")
	query.Set("fields", paidSubscriptionFields)
	endpoint := base + "/api/collections/" + coll + "/records?" + query.Encode()

	resp, err := pbAuthorizedGet(endpoint, token)
	if err != nil {
		return false, err
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
	case http.StatusOK:
	case http.StatusNotFound:
		return false, nil
	case http.StatusBadRequest, http.StatusUnauthorized, http.StatusForbidden:
		return false, nil
	default:
		return false, errUpstream(resp.StatusCode)
	}

	var body struct {
		Items []map[string]any `json:"items"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return false, err
	}

	return slices.ContainsFunc(body.Items, subscriptionRecordGrantsAccess), nil
}

type upstreamStatus int

func (e upstreamStatus) Error() string { return "auth service unavailable" }

func errUpstream(_ int) error { return upstreamStatus(0) }

func quoteForFilter(uid string) string {
	return `"` + strings.ReplaceAll(uid, `"`, `\"`) + `"`
}

func recordHasPaidAccess(record map[string]any) bool {
	if len(record) == 0 || explicitlyInactive(record) {
		return false
	}
	// Only trust explicit paid flags on the user record. Generic profile flags
	// like active/subscribed must never short-circuit the subscription lookup:
	// they are often user-editable and would let a user grant themselves access.
	for _, key := range []string{"isPaid", "is_paid", "paid", "hasPaidAccess", "has_paid"} {
		if v, ok := record[key]; ok && truthy(v) {
			return true
		}
	}
	for _, key := range []string{"status", "subscriptionStatus", "subscription_status", "plan", "tier", "subscription", "subscriptionTier", "membership"} {
		if v, ok := record[key]; ok && paidStatusString(v) {
			return true
		}
	}
	for _, key := range []string{"expiresAt", "expires", "currentPeriodEnd", "periodEnd", "paidUntil", "subscriptionExpiresAt"} {
		if v, ok := record[key]; ok && expiresInFuture(v) {
			return true
		}
	}
	return false
}

func subscriptionRecordGrantsAccess(item map[string]any) bool {
	if len(item) == 0 || explicitlyInactive(item) {
		return false
	}
	for _, key := range []string{"active", "isActive", "subscribed", "isPaid", "paid"} {
		if v, ok := item[key]; ok {
			if truthy(v) {
				return true
			}
		}
	}
	for _, key := range []string{"status", "state", "subscriptionStatus", "plan", "tier"} {
		if v, ok := item[key]; ok {
			if paidStatusString(v) {
				return true
			}
		}
	}
	for _, key := range []string{"expiresAt", "expires", "currentPeriodEnd", "periodEnd", "paidUntil"} {
		if v, ok := item[key]; ok {
			if expiresInFuture(v) {
				return true
			}
		}
	}
	return false
}

func explicitlyInactive(record map[string]any) bool {
	for _, key := range []string{"status", "state", "subscriptionStatus", "subscription_status"} {
		status, _ := record[key].(string)
		switch strings.ToLower(strings.TrimSpace(status)) {
		case "expired", "canceled", "cancelled", "suspended", "unpaid", "past_due", "refunded", "revoked":
			return true
		}
	}
	// A paid label must not override an expired or malformed explicit access boundary.
	for _, key := range []string{"expiresAt", "expires", "currentPeriodEnd", "periodEnd", "paidUntil", "subscriptionExpiresAt"} {
		if value, ok := record[key]; ok && value != nil && value != "" && !expiresInFuture(value) {
			return true
		}
	}
	return false
}

func truthy(v any) bool {
	switch t := v.(type) {
	case bool:
		return t
	case string:
		switch strings.ToLower(strings.TrimSpace(t)) {
		case "1", "true", "yes", "y", "active", "paid", "subscribed":
			return true
		}
	case float64:
		return t != 0
	case json.Number:
		return t.String() != "" && t.String() != "0"
	}
	return false
}

func paidStatusString(v any) bool {
	s, ok := v.(string)
	if !ok {
		return false
	}
	norm := strings.ToLower(strings.TrimSpace(s))
	switch norm {
	case "active", "trialing", "paid", "pro", "premium", "plus", "team", "business", "enterprise", "lifetime", "subscribed":
		return true
	}
	return slices.Contains(extraPaidPlans(), norm)
}

func expiresInFuture(v any) bool {
	s, ok := v.(string)
	if !ok || strings.TrimSpace(s) == "" {
		return false
	}
	for _, layout := range []string{time.RFC3339Nano, time.RFC3339, "2006-01-02 15:04:05.000Z07:00", "2006-01-02 15:04:05Z07:00", "2006-01-02"} {
		if t, err := time.Parse(layout, strings.TrimSpace(s)); err == nil {
			return t.After(time.Now())
		}
	}
	return false
}
