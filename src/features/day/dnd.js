/**
 * Custom MIME type for instructor drags. A custom type (rather than
 * 'text/plain') lets a drop target check `dataTransfer.types` during
 * dragover — the only phase where the payload itself is unreadable.
 */
export const INSTRUCTOR_DRAG_TYPE = 'application/x-mathnasium-instructor'
