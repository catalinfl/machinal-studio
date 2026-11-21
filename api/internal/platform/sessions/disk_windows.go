package sessions

// Disk-pressure eviction is skipped on Windows dev machines; the TTL sweep
// still applies. Production runs on Linux where disk_unix.go is used.
func diskUsageFraction(_ string) (float64, error) { return 0, nil }
