package scenecontract

import (
	"encoding/binary"
	"strings"
	"testing"
)

func containerFixture(metadata string) []byte {
	metadata += strings.Repeat(" ", (4-len(metadata)%4)%4)
	data := make([]byte, 28+len(metadata)+4)
	put := func(offset int, value uint32) { binary.LittleEndian.PutUint32(data[offset:offset+4], value) }
	put(0, 0x46546c67)
	put(4, 2)
	put(8, uint32(len(data)))
	put(12, uint32(len(metadata)))
	put(16, 0x4e4f534a)
	copy(data[20:], metadata)
	put(20+len(metadata), 4)
	put(24+len(metadata), 0x004e4942)
	return data
}

func TestModelContainerRejectsExternalAndUnsupportedFeatures(t *testing.T) {
	if err := ValidateModelContainer(containerFixture(`{"asset":{"version":"2.0"}}`)); err != nil {
		t.Fatal(err)
	}
	for _, metadata := range []string{
		`{"asset":{"version":"1.0"}}`,
		`{"asset":{"version":"2.0"},"buffers":[{"uri":"https://example.invalid/private.bin"}]}`,
		`{"asset":{"version":"2.0"},"images":[{"uri":"file:///private.png"}]}`,
		`{"asset":{"version":"2.0"},"extensionsUsed":["KHR_draco_mesh_compression"]}`,
		`{"asset":{"version":"2.0"},"animations":[{}]}`,
		`{"asset":{"version":"2.0"},"skins":[{}]}`,
		`{"asset":{"version":"2.0"},"extensionsUsed":true}`,
		`{"asset":{"version":"2.0"},"extras":{"__proto__":{}}}`,
	} {
		if err := ValidateModelContainer(containerFixture(metadata)); err == nil {
			t.Fatal("unsupported model accepted", metadata)
		}
	}
	valid := containerFixture(`{"asset":{"version":"2.0"}}`)
	for end := 0; end < len(valid); end++ {
		if ValidateModelContainer(valid[:end]) == nil {
			t.Fatal("truncated model accepted", end)
		}
	}
	if ValidateModelContainer(make([]byte, MaxModelBytes+1)) == nil {
		t.Fatal("oversized model accepted")
	}
	invalidUTF8 := containerFixture(`{"asset":{"version":"2.0"},"name":"subject"}`)
	invalidUTF8[20+strings.Index(string(invalidUTF8[20:]), "subject")] = 0xff
	if ValidateModelContainer(invalidUTF8) == nil {
		t.Fatal("invalid UTF-8 accepted")
	}
}

func FuzzModelContainer(f *testing.F) {
	f.Add(containerFixture(`{"asset":{"version":"2.0"}}`))
	f.Add([]byte("glTF"))
	f.Fuzz(func(t *testing.T, data []byte) { _ = ValidateModelContainer(data) })
}
