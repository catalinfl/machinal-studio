package soundlibrary

import (
	"bytes"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/url"
	"slices"
	"strings"
)

type openverseSound struct {
	ID             string  `json:"id"`
	Title          string  `json:"title"`
	Creator        string  `json:"creator"`
	LandingURL     string  `json:"foreign_landing_url"`
	URL            string  `json:"url"`
	License        string  `json:"license"`
	LicenseVersion string  `json:"license_version"`
	LicenseURL     string  `json:"license_url"`
	Attribution    string  `json:"attribution"`
	Provider       string  `json:"provider"`
	Duration       float64 `json:"duration"`
	Filetype       string  `json:"filetype"`
	Mature         bool    `json:"mature"`
}

func (item openverseSound) sound() (Sound, error) {
	if !ValidID(item.ID) || !AllowedLicense(item.License) || item.Mature || math.IsNaN(item.Duration) || math.IsInf(item.Duration, 0) || item.Duration <= 0 {
		return Sound{}, errors.New("Sound has unsupported identity, licence or duration.")
	}
	for _, text := range []string{item.Title, item.Creator, item.Attribution, item.URL, item.LandingURL, item.LicenseURL, item.Provider, item.LicenseVersion, item.Filetype} {
		if len(text) > 4000 || strings.ContainsAny(text, "\x00\r\n") {
			return Sound{}, errors.New("Sound metadata is invalid.")
		}
	}
	if !publicHTTPS(item.LandingURL) || !validLicenseURL(item.License, item.LicenseVersion, item.LicenseURL) || strings.TrimSpace(item.Title) == "" || strings.TrimSpace(item.Creator) == "" {
		return Sound{}, errors.New("Sound metadata lacks HTTPS provenance.")
	}
	sound := Sound{ID: item.ID, Title: item.Title, Creator: item.Creator, LandingURL: item.LandingURL, URL: item.URL, License: item.License, LicenseVersion: item.LicenseVersion, LicenseURL: item.LicenseURL, Attribution: item.Attribution, Provider: item.Provider, Duration: item.Duration / 1000, Filetype: strings.ToLower(item.Filetype)}
	if sound.Attribution == "" {
		sound.Attribution = fmt.Sprintf("%q by %s (%s %s): %s; %s", sound.Title, sound.Creator, sound.License, sound.LicenseVersion, sound.LandingURL, sound.LicenseURL)
	}
	sound.Importable = previewAllowed(sound.URL, sound.Filetype) && item.Provider == "freesound"
	encoded, err := json.Marshal(sound)
	if err != nil {
		return Sound{}, fmt.Errorf("encode sound source: %w", err)
	}
	sound.SourceVersion = fmt.Sprintf("sha256:%x", sha256.Sum256(encoded))
	if !publicHTTPS(sound.URL) {
		sound.URL = ""
	}
	return sound, nil
}

func publicHTTPS(value string) bool {
	u, err := url.Parse(value)
	return err == nil && u.Scheme == "https" && u.Hostname() != "" && u.User == nil && u.Fragment == "" && (u.Port() == "" || u.Port() == "443")
}

func validLicenseURL(license, version, address string) bool {
	if license == "cc0" {
		return version == "1.0" && address == "https://creativecommons.org/publicdomain/zero/1.0/"
	}
	return license == "by" && slices.Contains([]string{"1.0", "2.0", "2.5", "3.0", "4.0"}, version) && address == "https://creativecommons.org/licenses/by/"+version+"/"
}

func previewAllowed(value, filetype string) bool {
	u, err := url.Parse(value)
	if err != nil || !publicHTTPS(value) || u.Hostname() != "cdn.freesound.org" || u.RawQuery != "" || !strings.HasPrefix(u.Path, "/previews/") {
		return false
	}
	return (filetype == "mp3" || filetype == "wav" || filetype == "ogg" || filetype == "flac") && strings.HasSuffix(u.Path, "."+filetype)
}

func audioSignature(body []byte, filetype string) bool {
	if len(body) < 12 {
		return false
	}
	switch filetype {
	case "mp3":
		return bytes.HasPrefix(body, []byte("ID3")) || body[0] == 0xff && body[1]&0xe0 == 0xe0
	case "wav":
		return string(body[:4]) == "RIFF" && string(body[8:12]) == "WAVE"
	case "ogg":
		return string(body[:4]) == "OggS"
	case "flac":
		return string(body[:4]) == "fLaC"
	}
	return false
}
