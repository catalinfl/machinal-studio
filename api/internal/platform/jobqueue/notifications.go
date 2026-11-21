package jobqueue

type jobWatch struct {
	changed chan struct{}
	readers int
}

func (s *Service) watchJob(id string) (<-chan struct{}, func()) {
	s.watchMu.Lock()
	watch := s.watches[id]
	if watch == nil {
		watch = &jobWatch{changed: make(chan struct{})}
		s.watches[id] = watch
	}
	watch.readers++
	changed := watch.changed
	s.watchMu.Unlock()
	return changed, func() {
		s.watchMu.Lock()
		defer s.watchMu.Unlock()
		watch.readers--
		if watch.readers == 0 {
			delete(s.watches, id)
		}
	}
}

func (s *Service) jobChanges(id string) <-chan struct{} {
	s.watchMu.Lock()
	defer s.watchMu.Unlock()
	return s.watches[id].changed
}

func (s *Service) notifyJob(id string) {
	s.watchMu.Lock()
	defer s.watchMu.Unlock()
	if watch := s.watches[id]; watch != nil {
		close(watch.changed)
		watch.changed = make(chan struct{})
	}
}
