import { createSelector } from 'reselect'
import { compareTimestamp, insetSourceFrom, dateMin, dateMax } from '../common/utilities'
import { isTimeRangedIn, shuffle } from './helpers'
import { sizes } from '../common/global'

// Input selectors
export const getEvents = state => state.domain.events
export const getCategories = state => state.domain.categories
export const getNarratives = state => state.domain.narratives
export const getActiveNarrative = state => state.app.narrative
export const getActiveStep = state => state.app.narrativeState.current
export const getSelected = state => state.app.selected
export const getSites = (state) => {
  if (process.env.features.USE_SITES) return state.domain.sites.filter(s => !!(+s.enabled))
  return []
}
export const getSources = state => {
  if (process.env.features.USE_SOURCES) return state.domain.sources
  return {}
}
export const getShapes = state => {
  if (process.env.features.USE_SHAPES) return state.domain.shapes
  return []
}
export const getNotifications = state => state.domain.notifications
export const getTagTree = state => state.domain.tags
export const getActiveTags = state => state.app.filters.tags
export const getActiveCategories = state => state.app.filters.categories
export const getTimeRange = state => state.app.timeline.range
export const getTimelineDimensions = state => state.app.timeline.dimensions
export const selectNarrative = state => state.app.narrative

/**
 * Of all available events, selects those that
 * 1. fall in time range
 * 2. exist in an active tag
 * 3. exist in an active category
 */
export const selectEvents = createSelector(
  [getEvents, getActiveTags, getActiveCategories, getTimeRange],
  (events, activeTags, activeCategories, timeRange) => {
    return events.reduce((acc, event) => {
      const isMatchingTag = (event.tags && event.tags.map(tag => activeTags.includes(tag)).some(s => s)) || activeTags.length === 0
      const isActiveTag = isMatchingTag || activeTags.length === 0
      const isActiveCategory = activeCategories.includes(event.category) || activeCategories.length === 0
      const isActiveTime = isTimeRangedIn(event, timeRange)

      if (isActiveTime && isActiveTag && isActiveCategory) {
        acc[event.id] = { ...event }
      }

      return acc
    }, [])
  })

/**
 * Of all available events, selects those that fall within the time range,
 * and if TAGS are being used, select them if their tags are enabled
 */
export const selectNarratives = createSelector(
  [getEvents, getNarratives, getSources],
  (events, narrativesMeta, sources) => {
    const narratives = {}
    const narrativeSkeleton = id => ({ id, steps: [] })

    /* populate narratives dict with events */
    events.forEach(evt => {
      const isInNarrative = evt.narratives.length > 0

      evt.narratives.forEach(narrative => {
        // initialise
        if (!narratives[narrative]) { narratives[narrative] = narrativeSkeleton(narrative) }

        // add evt to steps
        if (isInNarrative) {
          // NB: insetSourceFrom is a 'curried' function to allow with maps
          narratives[narrative].steps.push(insetSourceFrom(sources)(evt))
        }
      })
    })

    /* sort steps by time */
    Object.keys(narratives).forEach(key => {
      const steps = narratives[key].steps

      steps.sort(compareTimestamp)

      if (narrativesMeta.find(n => n.id === key)) {
        narratives[key] = {
          ...narrativesMeta.find(n => n.id === key),
          ...narratives[key]
        }
      }
    })

    // Return narratives in original order
    // + filter those that are undefined
    return narrativesMeta.map(n => narratives[n.id]).filter(d => d)
  })

/** Aggregate information about the narrative and the current step into
 *  a single object. If narrative is null, the whole object is null.
 */
export const selectActiveNarrative = createSelector(
  [getActiveNarrative, getActiveStep],
  (narrative, current) => narrative
    ? { ...narrative, current }
    : null
)

/**
 * Group events by location. Each location is an object:
  {
    events: [...],
    label: 'Location name',
    latitude: '47.7',
    longitude: '32.2'
  }
 */
export const selectLocations = createSelector(
  [selectEvents],
  (events) => {
    const activeLocations = {}
    events.forEach(event => {
      const location = event.location

      if (activeLocations[location]) {
        activeLocations[location].events.push(event)
      } else {
        activeLocations[location] = {
          label: location,
          events: [event],
          latitude: event.latitude,
          longitude: event.longitude
        }
      }
    })

    return Object.values(activeLocations)
  }
)

/**
 * Group events by 'datetime'. Each datetime is  an object:
  {
    timestamp: '',
    date: '8/23/2016',
    time: '12:00',
    events: [...]
  }
 */
export const selectDatetimes = createSelector(
  [selectEvents],
  events => {
    const projects = {}
    const datetimes = {}
    events.forEach(event => {
      if (process.env.features.ASSOCIATIVE_EVENTS_BY_TAG) {
        const project = event.tags.length >= 1 ? event.tags[0] : null
        event = { ...event, project }
        if (project !== null) {
          if (projects.hasOwnProperty(project)) {
            projects[project].start = dateMin(projects[project].start, event.timestamp)
            projects[project].end = dateMax(projects[project].end, event.timestamp)
          } else {
            projects[project] = { start: event.timestamp, end: event.timestamp }
          }
        }
      }
      const { timestamp } = event
      if (datetimes.hasOwnProperty(timestamp)) {
        datetimes[timestamp].events.push(event)
      } else {
        datetimes[timestamp] = {
          timestamp: event.timestamp,
          date: event.date,
          time: event.time,
          events: [event]
        }
      }
    })
    // console.log(projects)
    // console.log(datetimes)
    const projKeys = Object.keys(projects)
    function checkActive (pj, dt) {
      return dt >= projects[pj].start && dt <= projects[pj].end
    }
    let sortedDts = Object.keys(datetimes)
    sortedDts.sort((a, b) => new Date(a) - new Date(b))
    sortedDts.forEach(dt => {
      const activeProjects = []
      projKeys.forEach((k, idx) => {
        if (checkActive(k, dt)) activeProjects.push(k)
      })
      datetimes[dt].events = datetimes[dt].events.map(ev => ({
        ...ev,
        projectOffset: (activeProjects.indexOf(ev.project)) * (2 * sizes.eventDotR + 5)
      }))
    })

    // TODO: calculate Y offset based on projects
    return Object.values(datetimes)
  }
)

/**
 * Of all the sources, select those that are relevant to the selected events.
 */
export const selectSelected = createSelector(
  [getSelected, getSources],
  (selected, sources) => {
    if (selected.length === 0) {
      return []
    }

    return selected.map(insetSourceFrom(sources))
  }
)

/**
 * Only categories that have events which are located should show on the
 * timeline.
 */
export const selectCategoriesWithTimeline = createSelector(
  [getCategories, getEvents],
  (categories, events) => {
    if (categories.length === 0) {
      return categories
    }
    // check for located events in category
    // shuffle first to improve chances of stopping more quickly
    const hasLocated = {}
    for (let event of shuffle(events)) {
      if (Object.keys(hasLocated).length === categories.length) break
      const cat = event.category
      if (hasLocated[cat]) continue
      const isLocated = !!event.longitude && !!event.latitude
      if (isLocated) hasLocated[cat] = true
    }
    return categories.filter(cat => hasLocated[cat.category])
  }
)

export const selectDimensions = createSelector(
  [getTimelineDimensions],
  (dimensions) => {
    return {
      ...dimensions,
      trackHeight: dimensions.contentHeight - 50 // height of time labels
    }
  }
)
