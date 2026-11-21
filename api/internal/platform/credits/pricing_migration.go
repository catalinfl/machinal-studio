package credits

import (
	"fmt"
	"os"
	"strings"
)

const legacyAIProviderBudgetPercent = 30

func preserveLegacyPricing(operation *Reservation) error {
	value := strings.TrimSpace(os.Getenv("CREDIT_LEGACY_USD_VALUE"))
	if operation.AIPricing != nil || value == "" {
		return nil
	}
	if _, err := positiveDecimal(value); err != nil {
		return fmt.Errorf("invalid legacy credit value: %w", err)
	}
	operation.AIPricing = &AIPricing{USDPerCredit: value, BudgetPercent: legacyAIProviderBudgetPercent}
	return nil
}
