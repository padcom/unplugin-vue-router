<script lang="ts">
import { defineColadaLoader } from 'unplugin-vue-router/runtime'
export const myExport = 'OUTSIDE SETUP TEST'

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export const useOldData = defineColadaLoader('/users/[id]', {
  async query(route) {
    return {
      when: new Date(),
      // if the id is not used, this data is cached forever
      id: route.params.id,
    }
  },
  key: (to) => ['user-id', to.params.id],
  staleTime: 5000,
})

// NOTE: it's a bit different from the one in /[name].vue
export const useUserData = defineBasicLoader(
  '/users/[id]',
  async (route) => {
    await delay(700)
    const user = {
      id: route.params.id,
      // @ts-expect-error: no param "name"!
      name: route.params.name || 'Edu',
      when: new Date().toUTCString(),
    }
    return user
  },
  {
    key: 'user-id',
    lazy: false,
  }
)
</script>

<script lang="ts" setup>
const route = useRoute('/users/[id]')

const { data: user, isLoading, error } = useUserData()
const { data: user2 } = useOldData()

definePage({
  beforeEnter(to) {
    if (Number.isNaN(Number(to.params.id))) {
      console.log('invalid param id', to.params.id)
      return false
    }
  },
})

const MY_VAL = 'INSIDE SETUP TEST'
</script>

<template>
  <main>
    <h1>defineBasicLoader()</h1>

    <pre>User: {{ route.params.id }}</pre>
    <p>{{ MY_VAL }}</p>

    <RouterLink :to="{ params: { id: Number(route.params.id) - 1 } }"
      >Previous</RouterLink
    >
    |
    <RouterLink :to="{ params: { id: Number(route.params.id) + 1 } }"
      >Next</RouterLink
    >

    <pre v-if="isLoading">Loading...</pre>
    <pre v-else-if="error">Error: {{ error }}</pre>
    <pre v-else>{{ user }}</pre>
  </main>
</template>

<route lang="ts">
const a = 20 as 20 | 30

console.log('WITHIN ROUTE_BLOCK', a)

export default {
  alias: '/u/:id',
  meta: {
    a,
    other: 'other',
  },
}
</route>
