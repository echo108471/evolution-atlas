import type { StoryLane } from './story'

export function formatDate(value: string) {
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export function formatSpan(lane: StoryLane) {
  const start = formatDate(new Date(lane.startTime).toISOString())
  const end = formatDate(new Date(lane.endTime).toISOString())
  return start === end ? start : `${start} – ${end}`
}
