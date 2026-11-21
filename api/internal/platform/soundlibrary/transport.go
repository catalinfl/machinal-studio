package soundlibrary

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/netip"
	"time"
)

var deniedNetworks = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"), netip.MustParsePrefix("100.64.0.0/10"),
	netip.MustParsePrefix("192.0.0.0/24"), netip.MustParsePrefix("192.0.2.0/24"),
	netip.MustParsePrefix("198.18.0.0/15"), netip.MustParsePrefix("198.51.100.0/24"), netip.MustParsePrefix("203.0.113.0/24"),
	netip.MustParsePrefix("192.88.99.0/24"), netip.MustParsePrefix("240.0.0.0/4"),
	netip.MustParsePrefix("2001::/23"), netip.MustParsePrefix("2001:db8::/32"), netip.MustParsePrefix("2002::/16"),
	netip.MustParsePrefix("64:ff9b::/96"), netip.MustParsePrefix("64:ff9b:1::/48"),
}

func publicIP(ip netip.Addr) bool {
	ip = ip.Unmap()
	if !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
		return false
	}
	if ip.Is6() && !netip.MustParsePrefix("2000::/3").Contains(ip) {
		return false
	}
	for _, prefix := range deniedNetworks {
		if prefix.Contains(ip) {
			return false
		}
	}
	return true
}

func NewHTTPClient() *http.Client {
	return &http.Client{Timeout: audioTimeout, CheckRedirect: func(*http.Request, []*http.Request) error {
		return errors.New("Sound library redirects are not allowed")
	}, Transport: &http.Transport{
		// No proxy, no caller-controlled hosts. Dial the checked IP itself so DNS
		// cannot change between validation and connection; TLS still verifies SNI.
		DialContext: dialPublicLibrary, TLSHandshakeTimeout: 8 * time.Second,
		ResponseHeaderTimeout: 10 * time.Second, MaxConnsPerHost: 4, MaxIdleConnsPerHost: 2, IdleConnTimeout: time.Minute,
	}}
}

type libraryIPLookup func(context.Context, string, string) ([]netip.Addr, error)
type libraryConnect func(context.Context, string, string) (net.Conn, error)

var dialPublicLibrary = libraryDialer(net.DefaultResolver.LookupNetIP, (&net.Dialer{Timeout: 8 * time.Second}).DialContext)

func libraryDialer(lookup libraryIPLookup, connect libraryConnect) libraryConnect {
	return func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil || port != "443" || host != "api.openverse.org" && host != "cdn.freesound.org" {
			return nil, errors.New("Sound library destination is not allowed")
		}
		ips, err := lookup(ctx, "ip", host)
		if err != nil || len(ips) == 0 {
			return nil, errors.New("Sound library DNS unavailable")
		}
		for _, ip := range ips {
			if !publicIP(ip) {
				return nil, errors.New("Sound library DNS resolved to a non-public network")
			}
		}
		for _, ip := range ips {
			if ctx.Err() != nil {
				break
			}
			connection, err := connect(ctx, network, net.JoinHostPort(ip.String(), port))
			if err == nil {
				return connection, nil
			}
		}
		return nil, errors.New("Sound library connection unavailable")
	}
}
