import { useRoute, useRouter } from 'vue-router'
import type {
  _RouteLocationNormalizedLoaded,
  _RouteRecordName,
} from '../type-extensions/routeLocation'
import type { _Router } from '../type-extensions/router'
import {
  DataLoaderContextBase,
  DataLoaderEntryBase,
  DefineDataLoaderOptionsBase,
  DefineLoaderFn,
  UseDataLoader,
  UseDataLoaderResult,
  _DataMaybeLazy,
} from './createDataLoader'
import {
  ABORT_CONTROLLER_KEY,
  APP_KEY,
  IS_USE_DATA_LOADER_KEY,
  LOADER_ENTRIES_KEY,
  NAVIGATION_RESULTS_KEY,
  PENDING_LOCATION_KEY,
  STAGED_NO_VALUE,
} from './meta-extensions'
import { IS_CLIENT, getCurrentContext, setCurrentContext } from './utils'
import { shallowRef } from 'vue'
import { NavigationResult } from './navigation-guard'

/**
 * Creates a data loader composable that can be exported by pages to attach the data loading to a route. This returns a
 * composable that can be used in any component.
 *
 * @experimental
 * Still under development and subject to change. See https://github.com/vuejs/rfcs/discussions/460
 *
 * @param name - name of the route to have typed routes
 * @param loader - function that returns a promise with the data
 * @param options - options to configure the data loader
 */
export function defineBasicLoader<
  Name extends _RouteRecordName,
  Data,
  isLazy extends boolean,
>(
  name: Name,
  loader: DefineLoaderFn<
    Data,
    DataLoaderContext,
    _RouteLocationNormalizedLoaded<Name>
  >,
  options?: DefineDataLoaderOptions<isLazy>
): UseDataLoader<isLazy, Data>
export function defineBasicLoader<Data, isLazy extends boolean>(
  loader: DefineLoaderFn<
    Data,
    DataLoaderContext,
    _RouteLocationNormalizedLoaded
  >,
  options?: DefineDataLoaderOptions<isLazy>
): UseDataLoader<isLazy, Data>

export function defineBasicLoader<Data, isLazy extends boolean>(
  nameOrLoader: _RouteRecordName | DefineLoaderFn<Data, DataLoaderContext>,
  _loaderOrOptions?:
    | DefineDataLoaderOptions<isLazy>
    | DefineLoaderFn<Data, DataLoaderContext>,
  opts?: DefineDataLoaderOptions<isLazy>
): UseDataLoader<isLazy, Data> {
  // TODO: make it DEV only and remove the first argument in production mode
  // resolve option overrides
  const loader =
    typeof nameOrLoader === 'function'
      ? nameOrLoader
      : (_loaderOrOptions! as DefineLoaderFn<Data, DataLoaderContext>)
  opts = typeof _loaderOrOptions === 'object' ? _loaderOrOptions : opts
  // {} as DefineDataLoaderOptions<isLazy>,
  const options = {
    ...DEFAULT_DEFINE_LOADER_OPTIONS,
    ...opts,
    // avoid opts overriding with `undefined`
    commit: opts?.commit || DEFAULT_DEFINE_LOADER_OPTIONS.commit,
  } as DefineDataLoaderOptions<isLazy>

  function load(
    to: _RouteLocationNormalizedLoaded,
    router: _Router,
    parent?: DataLoaderEntryBase
  ): Promise<void> {
    const entries = router[LOADER_ENTRIES_KEY]!
    if (!entries.has(loader)) {
      entries.set(loader, {
        // force the type to match
        data: shallowRef<_DataMaybeLazy<Data, isLazy>>(),
        isLoading: shallowRef(false),
        error: shallowRef<any>(),

        options,
        children: new Set(),
        resetPending() {
          this.pendingLoad = null
          this.pendingTo = null
        },
        pendingLoad: null,
        pendingTo: null,
        staged: STAGED_NO_VALUE,
        stagedError: null,
        commit,
      })
    }
    const entry = entries.get(loader)!

    // Nested loaders might get called before the navigation guard calls them, so we need to manually skip these calls
    if (entry.pendingTo === to && entry.pendingLoad) {
      // console.log(`🔁 already loading "${options.key}"`)
      return entry.pendingLoad
    }

    const { error, isLoading, data } = entry

    // FIXME: the key should be moved here and the strategy adapted to not depend on the navigation guard. This depends on how other loaders can be implemented.
    const initialRootData = router[INITIAL_DATA_KEY]
    const key = options.key || ''
    let initialData: unknown = STAGED_NO_VALUE
    if (initialRootData && key in initialRootData) {
      initialData = initialRootData[key]
      delete initialRootData[key]
    }

    // we are rendering for the first time and we have initial data
    // we need to synchronously set the value so it's available in components
    // even if it's not exported
    if (initialData !== STAGED_NO_VALUE) {
      data.value = initialData
      // pendingLoad is set for guards to work
      return (entry.pendingLoad = Promise.resolve())
    }

    // console.log(
    //   `😎 Loading context to "${to.fullPath}" with current "${currentContext[2]?.fullPath}"`
    // )
    // Currently load for this loader
    entry.pendingTo = to

    isLoading.value = true
    // save the current context to restore it later
    const currentContext = getCurrentContext()

    if (process.env.NODE_ENV === 'development') {
      if (parent !== currentContext[0]) {
        console.warn(
          `❌👶 "${options.key}" has a different parent than the current context. This shouldn't be happening. Please report a bug with a reproduction to https://github.com/posva/unplugin-vue-router/`
        )
      }
    }
    // set the current context before loading so nested loaders can use it
    setCurrentContext([entry, router, to])
    entry.staged = STAGED_NO_VALUE
    // preserve error until data is committed
    entry.stagedError = error.value

    // Promise.resolve() allows loaders to also be sync
    const currentLoad = Promise.resolve(
      loader(to, { signal: to.meta[ABORT_CONTROLLER_KEY]!.signal })
    )
      .then((d) => {
        // console.log(
        //   `✅ resolved ${options.key}`,
        //   to.fullPath,
        //   `accepted: ${entry.pendingLoad === currentLoad}; data: ${d}`
        // )
        if (entry.pendingLoad === currentLoad) {
          // let the navigation guard collect the result
          if (d instanceof NavigationResult) {
            to.meta[NAVIGATION_RESULTS_KEY]!.push(d)
          } else {
            entry.staged = d
            entry.stagedError = null
          }
        }
      })
      .catch((e) => {
        // console.log(
        //   '‼️ rejected',
        //   to.fullPath,
        //   `accepted: ${entry.pendingLoad === currentLoad} =`,
        //   e
        // )
        if (entry.pendingLoad === currentLoad) {
          // in this case, commit will never be called so we should just drop the error
          // console.log(`🚨 error in "${options.key}"`, e)
          entry.stagedError = e
          // propagate error if non lazy or during SSR
          // NOTE: Cannot be handled at the guard level because of nested loaders
          if (!options.lazy || !IS_CLIENT) {
            return Promise.reject(e)
          }
        }
      })
      .finally(() => {
        setCurrentContext(currentContext)
        // console.log(
        //   `😩 restored context ${options.key}`,
        //   currentContext?.[2]?.fullPath
        // )
        // TODO: could we replace with signal.aborted?
        if (entry.pendingLoad === currentLoad) {
          isLoading.value = false
          // we must run commit here so nested loaders are ready before used by their parents
          if (
            options.commit === 'immediate' ||
            // outside of navigation
            !router[PENDING_LOCATION_KEY]
          ) {
            entry.commit(to)
          }
        } else {
          // For debugging purposes and refactoring the code
          // console.log(
          //   to.meta[ABORT_CONTROLLER_KEY]!.signal.aborted ? '✅' : '❌'
          // )
        }
      })

    // restore the context after the first tick to avoid lazy loaders to use their own context as parent
    setCurrentContext(currentContext)

    // this still runs before the promise resolves even if loader is sync
    entry.pendingLoad = currentLoad
    // console.log(`🔶 Promise set to pendingLoad "${options.key}"`)

    return currentLoad
  }

  function commit(
    this: DataLoaderEntryBase,
    to: _RouteLocationNormalizedLoaded
  ) {
    if (this.pendingTo === to) {
      // console.log('👉 commit', this.staged)
      if (process.env.NODE_ENV === 'development') {
        if (this.staged === STAGED_NO_VALUE) {
          console.warn(
            `Loader "${options.key}"'s "commit()" was called but there is no staged data.`
          )
        }
      }

      // if the entry is null, it means the loader never resolved, maybe there was an error
      if (this.staged !== STAGED_NO_VALUE) {
        this.data.value = this.staged
      }
      // we always commit the error unless the navigation was cancelled
      this.error.value = this.stagedError

      // reset the staged values so they can't be commit
      this.staged = STAGED_NO_VALUE
      // preserve error until data is committed
      this.stagedError = this.error.value
      this.pendingTo = null
      // we intentionally keep pendingLoad so it can be reused until the navigation is finished

      // children entries cannot be committed from the navigation guard, so the parent must tell them
      for (const childEntry of this.children) {
        childEntry.commit(to)
      }
    }
  }

  // @ts-expect-error: requires the internals and symbol that are added later
  const useDataLoader: // for ts
  UseDataLoader<isLazy, Data> = () => {
    // work with nested data loaders
    const [parentEntry, _router, _route] = getCurrentContext()
    // fallback to the global router and routes for useDataLoaders used within components
    const router = _router || (useRouter() as _Router)
    const route = _route || (useRoute() as _RouteLocationNormalizedLoaded)

    const entries = router[LOADER_ENTRIES_KEY]!
    let entry = entries.get(loader)

    // console.log(`-- useDataLoader called ${options.key} --`)
    // console.log(
    //   'router pending location',
    //   router[PENDING_LOCATION_KEY]?.fullPath
    // )
    // console.log('target route', route.fullPath)
    // console.log('has parent', !!parentEntry)
    // console.log('has entry', !!entry)
    // console.log('entryLatestLoad', entry?.pendingTo?.fullPath)
    // console.log('is same route', entry?.pendingTo === route)
    // console.log('-- END --')

    if (process.env.NODE_ENV === 'development') {
      if (!parentEntry && !entry) {
        console.error(
          `Some "useDataLoader()" was called outside of a component's setup or a data loader.`
        )
      }
    }

    if (
      // if the entry doesn't exist, create it with load and ensure it's loading
      !entry ||
      // the existing pending location isn't good, we need to load again
      (parentEntry && entry.pendingTo !== route)
    ) {
      // console.log(
      //   `🔁 loading from useData for "${options.key}": "${route.fullPath}"`
      // )
      router[APP_KEY].runWithContext(() => load(route, router, parentEntry))
    }

    entry = entries.get(loader)!

    // add ourselves to the parent entry children
    if (parentEntry) {
      if (parentEntry === entry) {
        console.warn(
          `👶❌ "${options.key}" has itself as parent. This shouldn't be happening. Please report a bug with a reproduction to https://github.com/posva/unplugin-vue-router/`
        )
      }
      // console.log(`👶 "${options.key}" has parent ${parentEntry}`)
      parentEntry.children.add(entry!)
    }

    const { data, error, isLoading } = entry

    const useDataLoaderResult = {
      data,
      error,
      isLoading,
      reload: (
        // @ts-expect-error: needed for typed routes
        to: _RouteLocationNormalizedLoaded = router.currentRoute.value
      ) =>
        router[APP_KEY].runWithContext(() => load(to, router)).then(() =>
          entry!.commit(to)
        ),
    } satisfies UseDataLoaderResult

    // load ensures there is a pending load
    const promise = entry
      .pendingLoad!.then(() => {
        // nested loaders might wait for all loaders to be ready before setting data
        // so we need to return the staged value if it exists as it will be the latest one
        return entry!.staged === STAGED_NO_VALUE ? data.value : entry!.staged
      })
      // we only want the error if we are nesting the loader
      // otherwise this will end up in "Unhandled promise rejection"
      .catch((e) => (parentEntry ? Promise.reject(e) : null))

    return Object.assign(promise, useDataLoaderResult)
  }

  // mark it as a data loader
  useDataLoader[IS_USE_DATA_LOADER_KEY] = true

  // add the internals
  useDataLoader._ = {
    load,
    options,
    // @ts-expect-error: return type has the generics
    getEntry(router: Router) {
      return router[LOADER_ENTRIES_KEY]!.get(loader)!
    },
  }

  return useDataLoader
}

export interface DefineDataLoaderOptions<isLazy extends boolean>
  extends DefineDataLoaderOptionsBase<isLazy> {
  /**
   * Key to use for SSR state. This will be used to read the initial data from `initialData`'s object.
   */
  key?: string
}

export interface DataLoaderContext extends DataLoaderContextBase {}

const DEFAULT_DEFINE_LOADER_OPTIONS = {
  lazy: false as boolean,
  server: true,
  commit: 'immediate',
} satisfies DefineDataLoaderOptions<boolean>

/**
 * Symbol used to store the data in the router so it can be retrieved after the initial navigation.
 * @internal
 */
export const SERVER_INITIAL_DATA_KEY = Symbol()

/**
 * Initial data generated on server and consumed on client.
 * @internal
 */
export const INITIAL_DATA_KEY = Symbol()

// TODO: is it better to move this to an ambient declaration file so it's not included in the final bundle?

declare module 'vue-router' {
  interface Router {
    /**
     * Gives access to the initial state during rendering. Should be set to `false` once it's consumed.
     * @internal
     */
    [SERVER_INITIAL_DATA_KEY]?: Record<string, unknown> | false
    [INITIAL_DATA_KEY]?: Record<string, unknown> | false
  }
}
