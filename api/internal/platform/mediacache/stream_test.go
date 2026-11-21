package mediacache

import (
	"context"
	"errors"
	"io"
	"os"
	"strings"
	"testing"
	"time"
)

func TestStreamCancelsAChildWhenItsConsumerFails(t *testing.T) {
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	consumerErr := errors.New("synthetic consumer failure")
	err = Stream(ctx, executable, []string{"-test.run=^TestStreamChild$", "--", "--stream-helper"}, func(reader io.Reader) error {
		var first [16]byte
		if _, err := io.ReadFull(reader, first[:]); err != nil {
			return err
		}
		return consumerErr
	})
	if !errors.Is(err, consumerErr) || ctx.Err() != nil {
		t.Fatal("failed consumer did not cancel and reap its child", err)
	}
	if len(encodingSlots) != 0 {
		t.Fatal("stream leaked an encoder slot")
	}
}

func TestStreamChild(t *testing.T) {
	if os.Args[len(os.Args)-1] != "--stream-helper" {
		return
	}
	block := strings.Repeat("x", 64<<10)
	for {
		if _, err := io.WriteString(os.Stdout, block); err != nil {
			return
		}
	}
}
