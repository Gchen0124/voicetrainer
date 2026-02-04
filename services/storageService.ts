import { SavedSession, VocabularyItem, PracticeSession, VideoData } from '../types';

const SESSIONS_KEY = 'accentai_sessions';
const VOCABULARY_KEY = 'accentai_vocabulary';
const CURRENT_SESSION_KEY = 'accentai_current_session';

// ============ Session Storage ============

export const getAllSessions = (): SavedSession[] => {
  try {
    const data = localStorage.getItem(SESSIONS_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
};

export const getSession = (id: string): SavedSession | null => {
  const sessions = getAllSessions();
  return sessions.find(s => s.id === id) || null;
};

export const saveSession = (session: SavedSession): void => {
  const sessions = getAllSessions();
  const existingIndex = sessions.findIndex(s => s.id === session.id);

  if (existingIndex >= 0) {
    sessions[existingIndex] = { ...session, updatedAt: Date.now() };
  } else {
    sessions.push(session);
  }

  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
};

export const deleteSession = (id: string): void => {
  const sessions = getAllSessions().filter(s => s.id !== id);
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
};

export const createNewSession = (
  title: string,
  videoData: VideoData,
  motherTongue: string
): SavedSession => {
  const now = Date.now();
  const session: SavedSession = {
    id: `session-${now}`,
    title,
    videoData: {
      id: videoData.id,
      title: videoData.title,
      videoId: videoData.videoId,
      transcript: videoData.transcript,
      sourceType: videoData.sourceType,
      importedAt: videoData.importedAt,
    },
    practices: [],
    vocabulary: [],
    motherTongue,
    createdAt: now,
    updatedAt: now,
  };
  saveSession(session);
  return session;
};

// ============ Current Session Tracking ============

export const getCurrentSessionId = (): string | null => {
  return localStorage.getItem(CURRENT_SESSION_KEY);
};

export const setCurrentSessionId = (id: string | null): void => {
  if (id) {
    localStorage.setItem(CURRENT_SESSION_KEY, id);
  } else {
    localStorage.removeItem(CURRENT_SESSION_KEY);
  }
};

// ============ Practice Storage ============

export const savePractice = (sessionId: string, practice: PracticeSession): void => {
  const session = getSession(sessionId);
  if (!session) return;

  const existingIndex = session.practices.findIndex(
    p => p.segmentId === practice.segmentId
  );

  if (existingIndex >= 0) {
    session.practices[existingIndex] = practice;
  } else {
    session.practices.push(practice);
  }

  saveSession(session);
};

export const getPracticesForSegment = (sessionId: string, segmentId: string): PracticeSession[] => {
  const session = getSession(sessionId);
  if (!session) return [];
  return session.practices.filter(p => p.segmentId === segmentId);
};

// ============ Vocabulary Storage ============

export const getAllVocabulary = (): VocabularyItem[] => {
  try {
    const data = localStorage.getItem(VOCABULARY_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
};

export const addVocabularyItem = (item: VocabularyItem): void => {
  const vocabulary = getAllVocabulary();
  // Check if word already exists
  const existingIndex = vocabulary.findIndex(
    v => v.word.toLowerCase() === item.word.toLowerCase()
  );

  if (existingIndex >= 0) {
    // Update existing item
    vocabulary[existingIndex] = {
      ...vocabulary[existingIndex],
      ...item,
      reviewCount: (vocabulary[existingIndex].reviewCount || 0) + 1,
    };
  } else {
    vocabulary.push(item);
  }

  localStorage.setItem(VOCABULARY_KEY, JSON.stringify(vocabulary));

  // Also add to current session if exists
  const currentSessionId = getCurrentSessionId();
  if (currentSessionId) {
    const session = getSession(currentSessionId);
    if (session) {
      const vocabExistsInSession = session.vocabulary.some(
        v => v.word.toLowerCase() === item.word.toLowerCase()
      );
      if (!vocabExistsInSession) {
        session.vocabulary.push(item);
        saveSession(session);
      }
    }
  }
};

export const removeVocabularyItem = (id: string): void => {
  const vocabulary = getAllVocabulary().filter(v => v.id !== id);
  localStorage.setItem(VOCABULARY_KEY, JSON.stringify(vocabulary));
};

export const getVocabularyForSession = (sessionId: string): VocabularyItem[] => {
  const session = getSession(sessionId);
  return session?.vocabulary || [];
};

// ============ Utility Functions ============

export const exportSessionData = (sessionId: string): string | null => {
  const session = getSession(sessionId);
  if (!session) return null;
  return JSON.stringify(session, null, 2);
};

export const importSessionData = (jsonString: string): SavedSession | null => {
  try {
    const session = JSON.parse(jsonString) as SavedSession;
    // Generate new ID to avoid conflicts
    session.id = `session-${Date.now()}`;
    session.createdAt = Date.now();
    session.updatedAt = Date.now();
    saveSession(session);
    return session;
  } catch {
    return null;
  }
};

export const clearAllData = (): void => {
  localStorage.removeItem(SESSIONS_KEY);
  localStorage.removeItem(VOCABULARY_KEY);
  localStorage.removeItem(CURRENT_SESSION_KEY);
};
