package auth

import "sync"

var membershipAccess struct {
	sync.RWMutex
	check func(string) (bool, error)
}

func SetMembershipAccess(check func(string) (bool, error)) {
	membershipAccess.Lock()
	defer membershipAccess.Unlock()
	membershipAccess.check = check
}

func localMembershipAccess(owner string) (bool, error) {
	membershipAccess.RLock()
	check := membershipAccess.check
	membershipAccess.RUnlock()
	if check == nil || owner == "" {
		return false, nil
	}
	return check(owner)
}
