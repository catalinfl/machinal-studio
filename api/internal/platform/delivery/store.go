package delivery

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"ffmpeg-go-server/internal/platform/storage"
)

const (
	Lifetime       = time.Hour
	tokenBytes     = 32
	maxRecords     = 4096
	maxOwnerLinks  = 100
	maxRecordBytes = 4096
)

var (
	ErrNotFound = errors.New("delivery link not found")
	ErrLimit    = errors.New("too many active delivery links")
)

type Record struct {
	Owner     string    `json:"owner"`
	KeyID     string    `json:"keyId"`
	ProjectID string    `json:"projectId"`
	File      string    `json:"file"`
	Storage   string    `json:"storage"`
	ExpiresAt time.Time `json:"expiresAt"`
}

type Link struct {
	ID    string
	Token string
	Record
}

type Store struct {
	root   func() string
	now    func() time.Time
	random io.Reader
	mu     sync.RWMutex
}

func NewStore() *Store {
	return &Store{
		root: func() string { return filepath.Join(storage.DataDir, ".delivery-links") },
		now:  time.Now, random: rand.Reader,
	}
}

func validDigest(value string) bool {
	if len(value) != hex.EncodedLen(tokenBytes) {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil && value == strings.ToLower(value)
}

func tokenID(token string) string {
	digest := sha256.Sum256([]byte(token))
	return hex.EncodeToString(digest[:])
}

func validRecord(record Record) bool {
	if !storage.ValidUserID(record.Owner) || !storage.ValidUserID(record.KeyID) || !storage.ValidUserID(record.ProjectID) {
		return false
	}
	_, err := storage.SafeJoinIn(".", record.File)
	return err == nil && len(record.File) <= 255 && (record.Storage == "s3" || record.Storage == "volume")
}

func (s *Store) Create(record Record) (Link, error) {
	if !validRecord(record) {
		return Link{}, errors.New("invalid delivery link scope")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := os.MkdirAll(s.root(), 0700); err != nil {
		return Link{}, fmt.Errorf("create delivery directory: %w", err)
	}
	if err := s.pruneAndCheckLimit(record.Owner); err != nil {
		return Link{}, err
	}
	var random [tokenBytes]byte
	if _, err := io.ReadFull(s.random, random[:]); err != nil {
		return Link{}, fmt.Errorf("generate delivery token: %w", err)
	}
	token := hex.EncodeToString(random[:])
	record.ExpiresAt = s.now().UTC().Add(Lifetime)
	link := Link{ID: tokenID(token), Token: token, Record: record}
	if err := s.write(link); err != nil {
		return Link{}, err
	}
	return link, nil
}

func (s *Store) write(link Link) error {
	path := filepath.Join(s.root(), link.ID+".json")
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return fmt.Errorf("create delivery record: %w", err)
	}
	err = json.NewEncoder(file).Encode(link.Record)
	closeErr := file.Close()
	if err != nil || closeErr != nil {
		removeErr := os.Remove(path)
		return fmt.Errorf("save delivery record: %w", errors.Join(err, closeErr, removeErr))
	}
	return nil
}

func (s *Store) read(id string) (Record, error) {
	if !validDigest(id) {
		return Record{}, ErrNotFound
	}
	path := filepath.Join(s.root(), id+".json")
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return Record{}, ErrNotFound
	}
	if err != nil {
		return Record{}, fmt.Errorf("stat delivery record: %w", err)
	}
	if !info.Mode().IsRegular() || info.Size() > maxRecordBytes {
		return Record{}, ErrNotFound
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return Record{}, fmt.Errorf("read delivery record: %w", err)
	}
	var record Record
	if json.Unmarshal(data, &record) != nil || !validRecord(record) || record.ExpiresAt.IsZero() {
		return Record{}, ErrNotFound
	}
	return record, nil
}

func (s *Store) Get(token string) (Link, error) {
	if !validDigest(token) {
		return Link{}, ErrNotFound
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	id := tokenID(token)
	record, err := s.read(id)
	if err != nil {
		return Link{}, err
	}
	if !s.now().Before(record.ExpiresAt) {
		return Link{}, ErrNotFound
	}
	return Link{ID: id, Record: record}, nil
}

func (s *Store) Revoke(owner, project, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	record, err := s.read(id)
	if err != nil {
		return err
	}
	if record.Owner != owner || record.ProjectID != project {
		return ErrNotFound
	}
	if err := os.Remove(filepath.Join(s.root(), id+".json")); err != nil {
		return fmt.Errorf("revoke delivery link: %w", err)
	}
	return nil
}

func (s *Store) pruneAndCheckLimit(owner string) error {
	directory, err := os.Open(s.root())
	if err != nil {
		return fmt.Errorf("open delivery directory: %w", err)
	}
	defer directory.Close()
	entries, err := directory.ReadDir(maxRecords + 1)
	if err != nil && !errors.Is(err, io.EOF) {
		return fmt.Errorf("list delivery records: %w", err)
	}
	active, owned := 0, 0
	for _, entry := range entries {
		id := strings.TrimSuffix(entry.Name(), ".json")
		if !strings.HasSuffix(entry.Name(), ".json") || !validDigest(id) {
			active++
			continue
		}
		record, err := s.read(id)
		if err == nil && !s.now().Before(record.ExpiresAt) {
			if err := os.Remove(filepath.Join(s.root(), entry.Name())); err != nil {
				return fmt.Errorf("expire delivery record: %w", err)
			}
			continue
		}
		active++
		if err == nil && record.Owner == owner {
			owned++
		}
	}
	if active >= maxRecords || owned >= maxOwnerLinks {
		return ErrLimit
	}
	return nil
}
