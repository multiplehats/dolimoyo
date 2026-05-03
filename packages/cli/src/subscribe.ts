#!/usr/bin/env tsx
import { parseArgs } from 'node:util'

const { values } = parseArgs({
  options: {
    location: { type: 'string' },
    lat: { type: 'string' },
    lng: { type: 'string' },
    radius: { type: 'string', default: '25' },
    interests: { type: 'string' },
    cadence: { type: 'string' },
    email: { type: 'string', default: 'hi@chrisjayden.com' },
    kind: { type: 'string', default: 'home' },
    endsAt: { type: 'string' },
    api: { type: 'string', default: 'http://localhost:8787' },
    secret: { type: 'string' },
  },
})

const required = ['location', 'lat', 'lng', 'interests'] as const
for (const k of required) {
  if (!values[k]) {
    console.error(`missing required --${k}`)
    process.exit(1)
  }
}
const secret = values.secret ?? process.env.ADMIN_SECRET
if (!secret) {
  console.error('missing --secret or ADMIN_SECRET env var')
  process.exit(1)
}

const body = {
  userEmail: values.email,
  kind: values.kind,
  locationLabel: values.location,
  locationLat: Number(values.lat),
  locationLng: Number(values.lng),
  locationRadiusKm: Number(values.radius),
  interests: (values.interests as string).split(',').map((s) => s.trim()).filter(Boolean),
  cadence: values.cadence,
  endsAt: values.endsAt,
}

const res = await fetch(`${values.api}/subscriptions`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-admin-secret': secret },
  body: JSON.stringify(body),
})
if (!res.ok) {
  console.error('failed:', res.status, await res.text())
  process.exit(1)
}
console.log(await res.json())
