/**
 * @vitest-environment happy-dom
 */
import { App, defineComponent } from 'vue'
import {
  INITIAL_DATA_KEY,
  SERVER_INITIAL_DATA_KEY,
  defineBasicLoader,
} from './defineLoader'
import {
  describe,
  it,
  expect,
  vi,
  afterEach,
  beforeAll,
  afterAll,
} from 'vitest'
import { DataLoaderPlugin, DataLoaderPluginOptions } from './navigation-guard'
import { testDefineLoader } from '../../tests/data-loaders'
import { setCurrentContext } from './utils'
import { UseDataLoader } from './createDataLoader'
import { getRouter } from 'vue-router-mock'
import { enableAutoUnmount, mount } from '@vue/test-utils'
import RouterViewMock from '../../tests/data-loaders/RouterViewMock.vue'
import { mockedLoader } from '../../tests/utils'
import { RouteLocationNormalizedLoaded } from 'vue-router'

describe(
  'defineBasicLoader',
  // change it during dev while working on features
  // CI might need higher timeout
  { timeout: process.env.CI ? 1000 : 100 },
  () => {
    enableAutoUnmount(afterEach)

    // we use fake timers to ensure debugging tests do not rely on timers
    const now = new Date(2000, 0, 1).getTime() // 1 Jan 2000 in local time as number of milliseconds
    beforeAll(() => {
      vi.useFakeTimers()
      vi.setSystemTime(now)
    })

    afterAll(() => {
      vi.useRealTimers()
    })

    testDefineLoader(
      ({ fn, ...options }) => defineBasicLoader(fn, { ...options }),
      {
        beforeEach() {
          // invalidate current context
          setCurrentContext(undefined)
          // reset data used for SSR
          const router = getRouter()
          delete router[INITIAL_DATA_KEY]
          delete router[SERVER_INITIAL_DATA_KEY]
        },
      }
    )

    function singleLoaderOneRoute<Loader extends UseDataLoader>(
      useData: Loader,
      pluginOptions?: Omit<DataLoaderPluginOptions, 'router'>
    ) {
      let useDataResult: ReturnType<Loader>
      const component = defineComponent({
        setup() {
          // @ts-expect-error: wat?
          useDataResult = useData()

          const { data, error, isLoading } = useDataResult
          return { data, error, isLoading }
        },
        template: `\
<div>
  <p id="route">{{ $route.path }}</p>
  <p id="data">{{ data }}</p>
  <p id="error">{{ error }}</p>
  <p id="isLoading">{{ isLoading }}</p>
</div>`,
      })
      const router = getRouter()
      router.addRoute({
        name: '_test',
        path: '/fetch',
        meta: {
          loaders: [useData],
        },
        component,
      })

      const wrapper = mount(RouterViewMock, {
        global: {
          plugins: [[DataLoaderPlugin, { router, ...pluginOptions }]],
        },
      })

      const app: App = wrapper.vm.$.appContext.app

      return {
        wrapper,
        router,
        useData: () => {
          if (useDataResult) {
            return useDataResult
          }
          // forced to ensure similar running context to within a component
          // this is for tests that call useData() before the navigation is finished
          setCurrentContext(undefined)
          return app.runWithContext(() => useData()) as ReturnType<Loader>
        },
        app,
      }
    }

    describe('initialData', () => {
      it.skip('stores initialData', async () => {
        const router = getRouter()
        const spy1 = vi.fn().mockResolvedValue('f1')
        const spy2 = vi.fn().mockResolvedValue('f2')
        const l1 = defineBasicLoader(spy1, { key: 'd1' })
        const l2 = defineBasicLoader(spy2, { key: 'd2' })
        router.addRoute({
          name: '_test',
          path: '/fetch',
          component: defineComponent({
            setup() {
              const { data: d1 } = l1()
              const { data: d2 } = l2()
              return { d1, d2 }
            },
            template: `<p>{{ d1 }} {{ d2 }}</p>`,
          }),
          meta: {
            loaders: [l1, l2],
          },
        })
        const wrapper = mount(RouterViewMock, {
          global: {
            plugins: [
              [
                DataLoaderPlugin,
                {
                  router,
                },
              ],
            ],
          },
        })

        await router.push('/fetch?p=one')
        expect(spy1).toHaveBeenCalledTimes(1)
        expect(spy2).toHaveBeenCalledTimes(1)
        expect(router[SERVER_INITIAL_DATA_KEY]).toEqual({
          d1: 'f1',
          d2: 'f2',
        })
      })

      it('uses initialData if present', async () => {
        const spy = vi
          .fn<[to: RouteLocationNormalizedLoaded], Promise<string>>()
          .mockResolvedValue('initial')
        const { wrapper, app, router, useData } = singleLoaderOneRoute(
          defineBasicLoader(spy, { key: 'root' })
        )
        router[INITIAL_DATA_KEY] = { root: 'initial' }

        await router.push('/fetch?p=one')
        const { data } = useData()
        expect(data.value).toEqual('initial')
        expect(spy).toHaveBeenCalledTimes(0)
      })

      it('ignores initialData on subsequent navigations', async () => {
        const spy = vi
          .fn<[to: RouteLocationNormalizedLoaded], Promise<string>>()
          .mockImplementation(async (to) => to.query.p as string)
        const { wrapper, app, router, useData } = singleLoaderOneRoute(
          defineBasicLoader(spy, { key: 'root' })
        )

        router[INITIAL_DATA_KEY] = { root: 'initial' }

        await router.push('/fetch?p=one')
        await router.push('/fetch?p=two')
        const { data } = useData()
        expect(spy).toHaveBeenCalledTimes(1)
        expect(data.value).toEqual('two')
      })

      it('can use initialData on nested loaders that are not exported', async () => {
        const router = getRouter()
        const l1 = mockedLoader({ key: 'root' })
        const l2 = mockedLoader({ key: 'nested' })
        router.addRoute({
          name: '_test',
          path: '/fetch',
          component: defineComponent({
            setup() {
              const { data } = l1.loader()
              const { data: nested } = l2.loader()
              return { data, nested }
            },
            template: `<p>{{ data }} {{ nested }}</p>`,
          }),
          meta: {
            loaders: [
              // we purposely only expose the 1st loader
              l1.loader,
              // l2.loader,
            ],
          },
        })
        const wrapper = mount(RouterViewMock, {
          global: {
            plugins: [
              [
                DataLoaderPlugin,
                {
                  router,
                },
              ],
            ],
          },
        })
        const app: App = wrapper.vm.$.appContext.app
        router[INITIAL_DATA_KEY] = { root: 'initial', nested: 'nested-initial' }

        await router.push('/fetch?p=one')
        const { data: root, isLoading: rootPending } = app.runWithContext(() =>
          l1.loader()
        )
        const { data: nested, isLoading: nestedPending } = app.runWithContext(
          () => l2.loader()
        )
        expect(l1.spy).toHaveBeenCalledTimes(0)
        expect(l2.spy).toHaveBeenCalledTimes(0)
        expect(wrapper.text()).toBe('initial nested-initial')
        expect(root.value).toEqual('initial')
        expect(nested.value).toEqual('nested-initial')
        expect(rootPending.value).toEqual(false)
        expect(nestedPending.value).toEqual(false)
      })
    })
  }
)
