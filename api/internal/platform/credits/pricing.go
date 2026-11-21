package credits

import (
	"fmt"
	"math/big"
	"os"
	"strings"
)

const (
	aiProviderBudgetNumerator   = 2
	aiProviderBudgetDenominator = 10
	aiProviderBudgetPercent     = 100 * aiProviderBudgetNumerator / aiProviderBudgetDenominator
	MinimumAudioCredits         = 1
)

type Pricing struct {
	USDPerCredit    string
	RenderPerMinute string
}

type AIPricing struct {
	USDPerCredit  string `json:"usdPerCredit"`
	BudgetPercent int64  `json:"budgetPercent"`
}

func PricingFromEnv() Pricing {
	return Pricing{USDPerCredit: strings.TrimSpace(os.Getenv("CREDIT_USD_VALUE")), RenderPerMinute: strings.TrimSpace(os.Getenv("CREDIT_RENDER_PER_MINUTE"))}
}

func (p Pricing) Validate() error {
	for _, value := range []string{p.USDPerCredit, p.RenderPerMinute} {
		if _, err := positiveDecimal(value); err != nil {
			return fmt.Errorf("credit pricing is not configured")
		}
	}
	return nil
}

func (p Pricing) ValidateAI() error {
	if _, err := positiveDecimal(p.USDPerCredit); err != nil {
		return fmt.Errorf("AI credit pricing is not configured")
	}
	return nil
}

func positiveDecimal(value string) (*big.Rat, error) {
	if len(value) == 0 || len(value) > 24 || strings.ContainsAny(value, "/eE+-") {
		return nil, fmt.Errorf("invalid decimal")
	}
	ratio, ok := new(big.Rat).SetString(value)
	if !ok || ratio.Sign() <= 0 {
		return nil, fmt.Errorf("invalid decimal")
	}
	return ratio, nil
}

func wholeCreditUnits(value *big.Rat) (int64, error) {
	units := new(big.Int).Quo(value.Num(), value.Denom())
	units.Mul(units, big.NewInt(UnitsPerCredit))
	if !units.IsInt64() || value.Sign() < 0 {
		return 0, fmt.Errorf("usage exceeds accounting limits")
	}
	return units.Int64(), nil
}

func (p Pricing) AIUnits(usd string) (int64, error) {
	return p.aiUnits(usd, 0)
}

func (p Pricing) aiUnits(usd string, minimum int64) (int64, error) {
	return p.aiUnitsAtPercent(usd, minimum, aiProviderBudgetPercent)
}

func (p Pricing) aiUnitsAtPercent(usd string, minimum, budgetPercent int64) (int64, error) {
	if budgetPercent <= 0 || budgetPercent > 100 {
		return 0, fmt.Errorf("invalid AI budget percentage")
	}
	if len(usd) > 64 {
		return 0, fmt.Errorf("invalid provider cost")
	}
	cost, ok := new(big.Rat).SetString(usd)
	if !ok || cost.Sign() < 0 {
		return 0, fmt.Errorf("invalid provider cost")
	}
	if cost.Sign() == 0 {
		return 0, nil
	}
	price, err := positiveDecimal(p.USDPerCredit)
	if err != nil {
		return 0, err
	}
	// Only the AI share of a credit's face value funds upstream usage.
	price.Mul(price, big.NewRat(budgetPercent, 100))
	units, err := wholeCreditUnits(cost.Quo(cost, price))
	if err != nil {
		return 0, err
	}
	return max(units, minimum), nil
}

func (p Pricing) RenderUnits(seconds float64) (int64, error) {
	if seconds <= 0 || seconds > 24*60*60 {
		return 0, fmt.Errorf("invalid billable render duration")
	}
	rate, err := positiveDecimal(p.RenderPerMinute)
	if err != nil {
		return 0, err
	}
	duration := new(big.Rat).SetFloat64(seconds)
	if duration == nil {
		return 0, fmt.Errorf("invalid render duration")
	}
	return wholeCreditUnits(rate.Mul(rate, duration).Quo(rate, big.NewRat(60, 1)))
}
