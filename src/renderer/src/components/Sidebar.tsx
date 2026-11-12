import { Fragment, useEffect, useRef, useState } from 'react'
import type { Repo, Workspace } from '@shared/types'
import { visiblePrs } from '@shared/prInbox'
import { moveId, sortWorkspaces, type WorkspaceSort } from '@shared/sidebarOrder'
import { orchestratorRowKey, parseRowKey, viewRowKey } from '@shared/sidebarHidden'
import { Menu, type MenuItem } from './Menu'
import { LimitsFooter } from './LimitsFooter'
import { addProjectItems } from './AddProject'
import * as L from '@shared/layout'
import { useStore, showView, viewFor, openAddonPage, type DragItem, pinsToSetUp, newWorkspace, restoreWorkspace, openOrchestrator, openGroupOrchestrator, editGroup, archiveWorkspace, openPalette, openPrsPage, openAutomationsPage, reportError, setSidebarRowHidden, setRepoCollapsed } from '../store'
import { useHoverCard, WorkspacePreviewCard } from './WorkspacePreview'
import { IconAddon, IconArchive, IconBranch, IconDots, IconDown, IconGear, IconHome, IconLeft, IconMerged, IconOrchestrator, IconPlus, IconPR, IconRefresh, IconRepo, IconRight, IconSearch, IconSidebar, IconStack } from '../icons'
import { StackRows } from './Stack'
import { Stats } from './Stats'
import { prMenuItems, usePrState } from '../prState'
import { BrandMark } from './BrandMark'
import { UpdateBanners } from './Updates'
import { AddonActions, addonViews } from './Addons'
import { ProjectsSection } from './Projects'
<<<<<<< Updated upstream
<<<<<<< Updated upstream
import { inProject } from '@shared/projects'
import { buildLabel, sidebarVersion, type BuildInfo } from '@shared/uiComment'
=======
import { inProject, foldKey } from '@shared/projects'
>>>>>>> Stashed changes
=======
import { inProject, foldKey } from '@shared/projects'
>>>>>>> Stashed changes

export function Sidebar() {
  const s = useStore()
  const [showHidden, setShowHidden] = useState(false)
  const [showArchived, setShowArchived] = useState<Record<string, boolean>>({})
  const [view, setView] = useState<View>(loadView)
  const [menu, setMenu] = useState<'view' | 'add' | null>(null)
  const [repoMenu, setRepoMenu] = useState<{ id: string; el: HTMLElement } | null>(null)
  // Right-click menu on an Orchestrator or add-on row.
  const [rowMenu, setRowMenu] = useState<{ x: number; y: number; key: string } | null>(null)
  const hiddenRows = s.settings.sidebarHidden ?? []
  // With projects on, a project's workspaces list under the project, not under their repo.
  const projectsOn = !!s.settings.experimentalProjects
  const plain = (w: Workspace) => !projectsOn || !inProject(w, s.groups)
  const rowHidden = (key: string) => hiddenRows.includes(key)
  const hideMenu = (key: string) => (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setRowMenu({ x: e.clientX, y: e.clientY, key })
  }
  // Hidden rows that still exist, labelled for the menus that bring them back.
  const hiddenList = hiddenRows.flatMap((key) => {
    const r = parseRowKey(key)
    if (!r) return []
    const repo = r.repoId ? s.repos.find((x) => x.id === r.repoId) : undefined
    if (r.repoId && !repo) return []
    if (r.kind === 'orchestrator') return [{ key, repoId: r.repoId, label: 'Orchestrator', where: repo?.name }]
    const addon = s.addons.find((a) => a.key === r.addonKey && a.state === 'on')
    const view = addon?.manifest?.views?.find((v) => v.id === r.viewId)
    return view ? [{ key, repoId: r.repoId, label: view.title, where: repo?.name }] : []
  })
  const repoMenuItems = (repo: Repo): MenuItem[] => {
    const shows = hiddenList.filter((h) => h.repoId === repo.id).map((h): MenuItem => ({ label: `Show ${h.label}`, onClick: () => setSidebarRowHidden(h.key, false) }))
    return [...shows, ...(shows.length ? [{ kind: 'sep' } as const] : []), ...baseRepoItems(repo)]
  }
  const baseRepoItems = (repo: Repo): MenuItem[] => [
    {
      label: repo.hidden ? 'Show in sidebar' : 'Hide from sidebar',
      onClick: () => void window.api.setRepoHidden(repo.id, !repo.hidden).then(() => useStore.getState().set({ repos: s.repos.map((r) => (r.id === repo.id ? { ...r, hidden: !r.hidden } : r)) }))
    },
    { label: 'Reveal in Finder', onClick: () => void window.api.revealInFinder(repo.path) },
    { label: 'Manage workspaces…', onClick: () => s.set({ modal: 'settings', settingsTab: 'projects' }) },
    { kind: 'sep' },
    { label: 'Remove project…', onClick: () => s.set({ modal: 'remove-repo', removeRepoId: repo.id }) }
  ]
  const [drag, setDrag] = useState<{ id: string; over: string | null; after: boolean } | null>(null)
  const moveRepo = (id: string, target: string, after: boolean) => {
    if (id === target) return
    const ids = s.repos.map((r) => r.id).filter((x) => x !== id)
    ids.splice(ids.indexOf(target) + (after ? 1 : 0), 0, id)
    useStore.getState().set({ repos: ids.map((x) => s.repos.find((r) => r.id === x)!) })
    void window.api.reorderRepos(ids)
  }
  const headerRef = useRef<HTMLDivElement>(null)
  // The whole list under the Repos header folds, like the Projects section above it.
  const reposFolded = (s.settings.sidebarCollapsed ?? []).includes(foldKey.repos)
  const reposWaiting = s.chats.some((c) => (c.unread || (s.permissions[c.id]?.length ?? 0) > 0) && s.workspaces.some((w) => w.id === c.workspaceId && !w.archived))
  const updateView = (p: Partial<View>) => {
    const v = { ...view, ...p }
    setView(v)
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify(v))
    } catch {
      /* storage unavailable */
    }
  }
  const visible = s.repos.filter((r) => (showHidden || !r.hidden) && !view.filteredOut.includes(r.id))
  const sortWs = (list: Workspace[]) => sortWorkspaces(list, view.sort)
  // Dragging a workspace sorts by hand from then on. `list` is the ids shown in the same group, in order.
  const [wsDrag, setWsDrag] = useState<WsDrag | null>(null)
  const dropWorkspace = (list: string[]) => {
    if (!wsDrag?.over) return
    const ids = moveId(list, wsDrag.id, wsDrag.over, wsDrag.after)
    if (ids === list) return
    const pos = new Map(ids.map((id, i) => [id, i]))
    useStore.getState().set({ workspaces: useStore.getState().workspaces.map((w) => (pos.has(w.id) ? { ...w, order: pos.get(w.id) } : w)) })
    if (view.sort !== 'manual') updateView({ sort: 'manual' })
    void window.api.reorderWorkspaces(ids).catch(reportError)
  }
  const wsDragProps = (w: Workspace, list: string[]): WsDragProps | undefined =>
    w.orchestrator
      ? undefined
      : {
          drag: wsDrag,
          start: () => setWsDrag({ id: w.id, list: list.join(), over: null, after: false }),
          over: (after) => {
            if (!wsDrag || wsDrag.list !== list.join() || wsDrag.id === w.id) return false
            if (wsDrag.over !== w.id || wsDrag.after !== after) setWsDrag({ ...wsDrag, over: w.id, after })
            return true
          },
          drop: () => dropWorkspace(list),
          end: () => setWsDrag(null)
        }
  const viewItems: MenuItem[] = [
    {
      label: 'Group by',
      submenu: [
        { label: 'Project', checked: view.group === 'project', onClick: () => updateView({ group: 'project' }) },
        { label: 'None', checked: view.group === 'none', onClick: () => updateView({ group: 'none' }) }
      ]
    },
    {
      label: 'Filter by project',
      submenu: s.repos.length
        ? s.repos.map((r) => ({
            label: r.name,
            checked: !view.filteredOut.includes(r.id),
            keepOpen: true,
            onClick: () => updateView({ filteredOut: view.filteredOut.includes(r.id) ? view.filteredOut.filter((x) => x !== r.id) : [...view.filteredOut, r.id] })
          }))
        : [{ kind: 'label', label: 'No projects yet' }]
    },
    {
      label: 'Sort by',
      submenu: [
        { label: 'Newest first', checked: view.sort === 'newest', onClick: () => updateView({ sort: 'newest' }) },
        { label: 'Oldest first', checked: view.sort === 'oldest', onClick: () => updateView({ sort: 'oldest' }) },
        { label: 'Name', checked: view.sort === 'name', onClick: () => updateView({ sort: 'name' }) },
        { label: 'Manual (drag to sort)', checked: view.sort === 'manual', onClick: () => updateView({ sort: 'manual' }) }
      ]
    },
    ...(hiddenList.length
      ? [
          {
            label: `Hidden rows (${hiddenList.length})`,
            submenu: [
              ...hiddenList.map((h): MenuItem => ({ label: h.where ? `${h.label} · ${h.where}` : h.label, hint: 'Show', onClick: () => setSidebarRowHidden(h.key, false) })),
              { kind: 'sep' },
              { label: 'Show all', onClick: () => setSidebarRowHidden(hiddenList.map((h) => h.key), false) }
            ]
          } satisfies MenuItem
        ]
      : []),
    { kind: 'sep' },
    { label: 'Add project…', icon: <IconPlus />, keepOpen: true, onClick: () => setMenu('add') },
    { label: 'New project group…', icon: <IconOrchestrator />, onClick: () => editGroup(null) }
  ]
  const hiddenCount = s.repos.filter((r) => r.hidden).length
  const toReview = visiblePrs(s.prInbox?.prs ?? [], s.settings.prsHidden).filter((p) => p.roles.includes('review')).length
  // A hidden row still shows while it's the open page, so the page you're on never vanishes.
  const appViews = addonViews(s.addons, 'app').filter(({ addon, view }) => !rowHidden(viewRowKey(addon.key, view.id)) || (s.addonPage?.key === addon.key && s.addonPage.viewId === view.id && !s.addonPage.repoId))
  const repoViews = addonViews(s.addons, 'repo')

  return (
    <aside className="flex w-[280px] shrink-0 flex-col border-r border-line bg-sidebar">
      <div className="drag flex h-11 items-center gap-1 pr-2 pl-[84px]">
        <button className="no-drag rounded p-1 text-muted hover:bg-hover hover:text-fg" onClick={() => s.set({ sidebarOpen: false })} title="Hide sidebar (⌘B)">
          <IconSidebar width={16} height={16} />
        </button>
        <div className="flex-1" />
        <button title="Back" className="no-drag rounded p-1 text-muted hover:bg-hover hover:text-fg disabled:opacity-30" disabled={s.historyIndex <= 0} onClick={s.back}>
          <IconLeft width={16} height={16} />
        </button>
        <button title="Forward" className="no-drag rounded p-1 text-muted hover:bg-hover hover:text-fg disabled:opacity-30" disabled={s.historyIndex >= s.history.length - 1} onClick={s.forward}>
          <IconRight width={16} height={16} />
        </button>
      </div>

      <nav className="px-2 pb-3">
        <NavItem icon={<IconHome />} label="Home" active={!s.panesShown && !s.draftRepo && !s.prsPage && !s.automationsPage} onClick={() => s.selectWorkspace(null)} />
        <NavItem icon={<IconPlus />} label="Create" onClick={() => s.set({ modal: 'create' })} />
        <NavItem icon={<IconSearch />} label="Search" onClick={() => openPalette()} hint="⌘K" />
        <NavItem
          icon={<IconPR />}
          label="PRs"
          title="Pull requests waiting on your review, and the ones you opened"
          active={s.prsPage && !s.selectedWs}
          onClick={openPrsPage}
          badge={toReview || undefined}
        />
        {projectsOn && (
          <NavItem
            icon={<IconRefresh />}
            label="Automations"
            title="Checks that run on a schedule or a GitHub event and open a workspace per finding"
            active={s.automationsPage && !s.selectedWs}
            onClick={openAutomationsPage}
            hint={s.automations.filter((a) => a.enabled).length ? String(s.automations.filter((a) => a.enabled).length) : undefined}
          />
        )}
        {appViews.map(({ addon, view }) => (
          <NavItem
            key={`${addon.key}/${view.id}`}
            icon={<IconAddon />}
            label={view.title}
            title={`From the ${addon.name} add-on`}
            active={s.addonPage?.key === addon.key && s.addonPage.viewId === view.id && !s.addonPage.repoId}
            onClick={(e) => openAddonPage({ key: addon.key, viewId: view.id }, e?.metaKey ? 'right' : undefined)}
            onContextMenu={hideMenu(viewRowKey(addon.key, view.id))}
            drag={{ kind: 'addon', key: addon.key, viewId: view.id }}
            actions={<><AddonActions place="view-row" view={{ key: addon.key, viewId: view.id }} /><PageSlot page={{ key: addon.key, viewId: view.id }} /></>}
          />
        ))}
      </nav>

      <div className="border-t border-line" />

      <div className="flex-1 overflow-y-auto px-2 py-3">
        {projectsOn && <ProjectsSection />}
        <div ref={headerRef} className="mb-1 flex items-center px-2 text-[11px] font-medium text-faint">
          <button
            className="flex flex-1 items-center gap-1 text-left hover:text-fg"
            onClick={() => setRepoCollapsed(foldKey.repos, !reposFolded)}
            title={reposFolded ? 'Show repos' : 'Fold repos'}
          >
            <IconDown width={12} height={12} className={reposFolded ? '-rotate-90' : ''} />
            {projectsOn ? 'Repos' : 'My workspaces'}
            {reposFolded && reposWaiting && <span className="ml-1 h-1.5 w-1.5 rounded-full bg-accent" title="A workspace is unread or waiting on you" />}
          </button>
          <button className="rounded p-0.5 hover:bg-hover hover:text-fg" title="View options" onClick={() => setMenu(menu ? null : 'view')}>
            <IconDots />
          </button>
          <button className="rounded p-0.5 hover:bg-hover hover:text-fg" title="Add project" onClick={() => setMenu(menu === 'add' ? null : 'add')}>
            <IconPlus />
          </button>
          {repoMenu && s.repos.some((r) => r.id === repoMenu.id) && <Menu anchor={repoMenu.el} items={repoMenuItems(s.repos.find((r) => r.id === repoMenu.id)!)} onClose={() => setRepoMenu(null)} />}
          {menu && <Menu anchor={headerRef.current} items={menu === 'view' ? viewItems : addProjectItems()} onClose={() => setMenu(null)} />}
          {rowMenu && <Menu anchor={null} at={rowMenu} items={[{ label: 'Hide from sidebar', onClick: () => setSidebarRowHidden(rowMenu.key, true) }]} onClose={() => setRowMenu(null)} />}
        </div>
        {!reposFolded && (
          <>
        {!projectsOn && s.groups.length > 0 && (
          <div className="mb-3">
            <div className="mb-1 flex items-center px-2 text-[11px] font-medium text-faint">
              <span className="flex-1">Project groups</span>
              <button className="rounded p-0.5 hover:bg-hover hover:text-fg" title="New project group" onClick={() => editGroup(null)}>
                <IconPlus />
              </button>
            </div>
            {s.groups.map((g) => {
              const orch = s.workspaces.find((w) => w.orchestrator && w.groupId === g.id && !w.archived)
              const names = g.repoIds.map((id) => s.repos.find((r) => r.id === id)?.name).filter(Boolean).join(', ')
              const running = !!orch && s.chats.some((c) => c.workspaceId === orch.id && c.status === 'running')
              const active = !!orch && s.selectedWs === orch.id
              return (
                <div key={g.id} className={`group flex h-9 cursor-pointer items-center gap-2 rounded-md px-2 ${active ? 'bg-raised' : 'hover:bg-hover'}`} onClick={() => void openGroupOrchestrator(g.id)} title={`Orchestrator for ${names}`}>
                  {running ? <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-faint border-t-accent" /> : <IconOrchestrator className="shrink-0 text-faint" />}
                  <span className="truncate font-medium">{g.name}</span>
                  <span className="flex-1 truncate text-[11px] text-faint">{names}</span>
                  <button
                    className="invisible rounded px-1 text-[11px] text-faint group-hover:visible hover:text-fg"
                    onClick={(e) => {
                      e.stopPropagation()
                      editGroup(g.id)
                    }}
                  >
                    Edit
                  </button>
                </div>
              )
            })}
          </div>
        )}
        {visible.length === 0 && (
          <button onClick={() => s.set({ modal: 'create' })} className="mx-2 mt-2 w-[calc(100%-16px)] rounded-lg border border-dashed border-line px-3 py-4 text-left text-muted hover:border-faint hover:text-fg">
            Add a repository to get started
          </button>
        )}
        {view.group === 'none' &&
          (() => {
            const list = sortWs(s.workspaces.filter((w) => !w.archived && !w.orchestrator && plain(w) && visible.some((r) => r.id === w.repoId)))
            const ids = list.map((w) => w.id)
            return list.map((w) => <WsRow key={w.id} w={w} repoName={s.repos.find((r) => r.id === w.repoId)?.name} dnd={wsDragProps(w, ids)} />)
          })()}
        {view.group === 'project' && visible.map((repo) => {
          // The orchestrator, if open, sits at the top of its repo.
          // A hidden orchestrator still shows while it's open or waiting on you.
          const orchHidden = rowHidden(orchestratorRowKey(repo.id))
          const showWs = (w: Workspace) => !w.orchestrator || !orchHidden || s.selectedWs === w.id || s.chats.some((c) => c.workspaceId === w.id && (s.permissions[c.id]?.length ?? 0) > 0)
          const wss = sortWs(s.workspaces.filter((w) => w.repoId === repo.id && !w.archived && !w.groupId && plain(w) && showWs(w))).sort((a, b) => Number(!!b.orchestrator) - Number(!!a.orchestrator))
          const archived = s.workspaces.filter((w) => w.repoId === repo.id && w.archived && !w.orchestrator && plain(w)).sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0))
          const wsIds = wss.filter((w) => !w.orchestrator).map((w) => w.id)
          const collapsed = (s.settings.sidebarCollapsed ?? []).includes(repo.id)
          const childIds = new Set(s.workspaces.filter((w) => w.repoId === repo.id && !w.archived && !w.groupId && plain(w)).map((w) => w.id))
          const childCount = wss.filter((w) => !w.orchestrator).length
          const childNeedsYou = collapsed && s.chats.some((c) => childIds.has(c.workspaceId) && (c.unread || (s.permissions[c.id]?.length ?? 0) > 0))
          return (
            <div
              key={repo.id}
              className={`mb-1 ${drag?.over === repo.id && drag.id !== repo.id ? (drag.after ? 'shadow-[0_2px_0_var(--color-accent)]' : 'shadow-[0_-2px_0_var(--color-accent)]') : ''} ${drag?.id === repo.id ? 'opacity-50' : ''}`}
              onDragOver={(e) => {
                if (!drag) return
                e.preventDefault()
                const r = e.currentTarget.getBoundingClientRect()
                const after = e.clientY > r.top + Math.min(r.height, 36) / 2
                if (drag.over !== repo.id || drag.after !== after) setDrag({ ...drag, over: repo.id, after })
              }}
              onDrop={(e) => {
                e.preventDefault()
                if (drag) moveRepo(drag.id, repo.id, drag.after)
                setDrag(null)
              }}
            >
              <div
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'move'
                  setDrag({ id: repo.id, over: null, after: false })
                }}
                onDragEnd={() => setDrag(null)}
                title="Drag to reorder"
                className="group flex h-9 cursor-grab items-center gap-2 rounded-md px-2 hover:bg-hover active:cursor-grabbing"
              >
                <button
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-raised"
                  title={collapsed ? 'Expand project' : 'Collapse project'}
                  aria-expanded={!collapsed}
                  onClick={() => setRepoCollapsed(repo.id, !collapsed)}
                >
                  <span className="flex group-hover:hidden">
                    <RepoIcon repo={repo} />
                  </span>
                  <IconDown width={14} height={14} className={`hidden text-muted group-hover:block ${collapsed ? '-rotate-90' : ''}`} />
                </button>
                <span className={`flex-1 truncate font-medium ${repo.hidden ? 'text-faint' : ''}`}>
                  {repo.name}
                  {collapsed && childCount > 0 && <span className="ml-1.5 text-[11px] font-normal text-faint">{childCount}</span>}
                  {childNeedsYou && <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-accent align-middle shadow-[0_0_6px_var(--color-accent)]" />}
                </span>
                <button
                  className={`rounded p-1 text-muted hover:bg-raised hover:text-fg ${repoMenu?.id === repo.id ? '' : 'invisible group-hover:visible'}`}
                  title="Project settings"
                  onClick={(e) => setRepoMenu({ id: repo.id, el: e.currentTarget })}
                >
                  <IconDots />
                </button>
                <AddonActions place="project-row" repoId={repo.id} className="invisible p-1 text-muted group-hover:visible hover:bg-raised focus-visible:visible" />
                <button className="rounded p-1 text-muted hover:bg-raised hover:text-fg" title="Orchestrator: tell it what you want and it runs workspaces for you" onClick={() => void openOrchestrator(repo.id)}>
                  <IconOrchestrator />
                </button>
                <button className="rounded p-1 text-muted hover:bg-raised hover:text-fg" title="New workspace" onClick={() => newWorkspace(repo.id)}>
                  <IconPlus />
                </button>
              </div>
              {!collapsed && (
                <>
                  <PinRow repoId={repo.id} />
                  {repoViews.map(({ addon, view }) => {
                    const on = s.addonPage?.key === addon.key && s.addonPage.viewId === view.id && s.addonPage.repoId === repo.id
                    const key = viewRowKey(addon.key, view.id, repo.id)
                    if (rowHidden(key) && !on) return null
                    return (
                      <button
                        key={`${addon.key}/${view.id}`}
                        title={`From the ${addon.name} add-on`}
                        onClick={(e) => openAddonPage({ key: addon.key, viewId: view.id, repoId: repo.id }, e.metaKey ? 'right' : undefined)}
                        onContextMenu={hideMenu(key)}
                        {...paneDragProps({ kind: 'addon', key: addon.key, viewId: view.id, repoId: repo.id })}
                        className={`flex h-9 w-full items-center gap-2 rounded-md pr-2 pl-5 text-left ${on ? 'bg-raised text-fg' : 'text-muted hover:bg-hover hover:text-fg'}`}
                      >
                        <IconAddon className="shrink-0" />
                        <span className="flex-1 truncate">{view.title}</span>
                        <AddonActions place="view-row" repoId={repo.id} view={{ key: addon.key, viewId: view.id }} />
                        <PageSlot page={{ key: addon.key, viewId: view.id, repoId: repo.id }} />
                      </button>
                    )
                  })}
                  {wss.map((w) => (
                    <Fragment key={w.id}>
                      <WsRow w={w} dnd={wsDragProps(w, wsIds)} />
                      {w.stack && <StackRows ws={w} />}
                    </Fragment>
                  ))}
                  {archived.length > 0 && (
                    <button
                      className="flex h-7 w-full items-center pl-5 text-left text-[11px] text-faint hover:text-muted"
                      onClick={() => setShowArchived({ ...showArchived, [repo.id]: !showArchived[repo.id] })}
                    >
                      {showArchived[repo.id] ? 'Hide archived' : `Archived (${archived.length})`}
                    </button>
                  )}
                  {showArchived[repo.id] &&
                    archived.map((w) => (
                      <div key={w.id} className="group flex h-8 items-center gap-2 rounded-md pr-2 pl-5 text-faint hover:bg-hover">
                        <IconBranch className="shrink-0" />
                        <span className="flex-1 truncate" title={w.branch}>
                          {w.title}
                        </span>
                        <button className="invisible rounded px-1.5 text-[11px] text-muted group-hover:visible hover:bg-raised hover:text-fg" onClick={() => void restoreWorkspace(w.id)}>
                          Restore
                        </button>
                      </div>
                    ))}
                </>
              )}
            </div>
          )
        })}
        {hiddenCount > 0 && (
          <button className="mt-2 px-2 text-[12px] text-faint hover:text-fg" onClick={() => setShowHidden(!showHidden)}>
            {showHidden ? 'Hide hidden repositories' : 'Show hidden repositories'}
          </button>
        )}
          </>
        )}
      </div>

      <UpdateBanners openSettings={() => s.set({ modal: 'settings', settingsTab: 'updates' })} />
      <div className="border-t border-line">
        <LimitsFooter />
      </div>
      <div className="flex items-center gap-2 px-3 py-2 text-faint">
        <BrandMark size={14} />
        <span className="text-[11px]">Choo Choo</span>
        <AppVersion />
        <button className="rounded p-1 hover:bg-hover hover:text-fg" title="Settings (⌘,)" onClick={() => s.set({ modal: 'settings' })}>
          <IconGear />
        </button>
      </div>
    </aside>
  )
}

/** The app version (packaged) or `<sha>-dev` (npm run dev), from the same build info comment mode uses. */
function AppVersion() {
  const [info, setInfo] = useState<BuildInfo | null>(null)
  useEffect(() => {
    const bridge = (window as unknown as { uiComment?: { info(): Promise<BuildInfo> } }).uiComment
    void bridge?.info().then(setInfo, () => {})
  }, [])
  return (
    <span className="flex-1 truncate text-[11px] opacity-70" title={info ? buildLabel(info) : undefined}>
      {info ? sidebarVersion(info) : ''}
    </span>
  )
}

function NavItem(p: { icon: React.ReactNode; label: string; title?: string; active?: boolean; hint?: string; badge?: number; actions?: React.ReactNode; onClick: (e?: React.MouseEvent) => void; onContextMenu?: (e: React.MouseEvent) => void; drag?: DragItem }) {
  return (
    <button onClick={(e) => p.onClick(e)} onContextMenu={p.onContextMenu} title={p.title} {...(p.drag ? paneDragProps(p.drag) : {})} className={`flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left ${p.active ? 'bg-raised' : 'hover:bg-hover'}`}>
      <span className="text-muted">{p.icon}</span>
      <span className="flex-1">{p.label}</span>
      {p.hint && <span className="text-[11px] text-faint">{p.hint}</span>}
      {!!p.badge && <span className="rounded-full bg-accent/20 px-1.5 text-[11px] font-medium text-accent">{p.badge}</span>}
      {p.actions}
    </button>
  )
}

/** Lets a sidebar row be dragged onto the panes to open it there (Panes.tsx draws the drop targets). */
function paneDragProps(item: DragItem) {
  return {
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', item.kind)
      useStore.getState().set({ drag: item })
    },
    onDragEnd: () => useStore.getState().set({ drag: null })
  }
}

type PageRef = { key: string; viewId: string; repoId?: string }
/** Where a workspace or add-on page is open when the center is split: which pane, and whether it's the focused one. */
function usePaneSlot(target: string | PageRef): { focused: boolean; side: 'left' | 'right' | 'mid' } | null {
  const wsId = typeof target === 'string' ? target : `${target.key}/${target.viewId}/${target.repoId ?? ''}`
  return useStore((s) => {
    if (!s.panesShown || !s.layout) return null
    const all = L.leaves(s.layout)
    if (all.length < 2) return null
    const leaf = typeof target === 'string' ? L.leafOfWorkspace(s.layout, target) : L.leafOfAddon(s.layout, target.key, target.viewId, target.repoId)
    if (!leaf) return null
    const b = L.boxes(s.layout.root).leaves.get(leaf.id)
    if (!b) return null
    const cx = b.x + b.w / 2
    const side = cx < 0.4 ? 'left' : cx > 0.6 ? 'right' : 'mid'
    const focused = s.layout.focus === leaf.id
    return paneSlotCache(wsId, focused, side)
  })
}
const slotCache = new Map<string, { focused: boolean; side: 'left' | 'right' | 'mid' }>()
function paneSlotCache(wsId: string, focused: boolean, side: 'left' | 'right' | 'mid') {
  const k = `${wsId}:${focused}:${side}`
  let v = slotCache.get(k)
  if (!v) slotCache.set(k, (v = { focused, side }))
  return v
}

function PageSlot({ page }: { page: PageRef }) {
  const slot = usePaneSlot(page)
  return slot ? <PaneSlotIcon slot={slot} /> : null
}

function PaneSlotIcon({ slot }: { slot: { focused: boolean; side: 'left' | 'right' | 'mid' } }) {
  const fill = slot.focused ? 'bg-accent' : 'bg-muted'
  const pos = slot.side === 'left' ? 'left-px' : slot.side === 'right' ? 'right-px' : 'left-[5px]'
  return (
    <span className="relative h-[13px] w-[18px] shrink-0 rounded-[3px] border-[1.4px] border-faint" title={slot.focused ? 'Open in the focused pane' : `Open in the ${slot.side === 'mid' ? 'middle' : slot.side} pane`}>
      <span className={`absolute top-px bottom-px w-[6px] rounded-[1px] ${pos} ${fill}`} />
    </span>
  )
}

type WsDrag = { id: string; list: string; over: string | null; after: boolean }
type WsDragProps = { drag: WsDrag | null; start: () => void; over: (after: boolean) => boolean; drop: () => void; end: () => void }

function WsRow({ w, repoName, dnd }: { w: Workspace; repoName?: string; dnd?: WsDragProps }) {
  const s = useStore()
  const hover = useHoverCard()
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null)
  const [editing, setEditing] = useState(false)
  const [naming, setNaming] = useState(false)
  const rename = (title: string) => {
    setEditing(false)
    const t = title.replace(/\s+/g, ' ').trim()
    if (!t || t === w.title) return
    useStore.getState().set({ workspaces: useStore.getState().workspaces.map((x) => (x.id === w.id ? { ...x, title: t, named: true } : x)) })
    void window.api.renameWorkspace(w.id, t).catch(reportError)
  }
  const regenerate = async () => {
    setNaming(true)
    try {
      const title = await window.api.regenerateWorkspaceName(w.id)
      useStore.getState().set({ workspaces: useStore.getState().workspaces.map((x) => (x.id === w.id ? { ...x, title, named: true } : x)) })
    } catch (e) {
      reportError(e)
    } finally {
      setNaming(false)
    }
  }
  // The orchestrator can only be hidden; the button on the project row still opens it.
  const menuItems: MenuItem[] = w.orchestrator
    ? [{ label: 'Hide from sidebar', onClick: () => setSidebarRowHidden(orchestratorRowKey(w.repoId), true) }]
    : [
        { label: 'Open to the side', hint: '⌘-click', onClick: () => showView(viewFor(w.id), 'right') },
        { kind: 'sep' },
        { label: 'Rename…', onClick: () => setEditing(true) },
        { label: 'Regenerate name', hint: 'from the chat', onClick: () => void regenerate() },
        { kind: 'sep' },
        { label: 'Reveal in Finder', onClick: () => void window.api.revealInFinder(w.path) },
        { label: 'Copy branch name', onClick: () => void navigator.clipboard.writeText(w.branch) },
        { kind: 'sep' },
        { label: 'Archive workspace', onClick: () => void archiveWorkspace(w.id) }
      ]
  const dropLine = dnd?.drag?.over === w.id ? (dnd.drag.after ? 'shadow-[0_2px_0_var(--color-accent)]' : 'shadow-[0_-2px_0_var(--color-accent)]') : ''
  const running = s.chats.some((c) => c.workspaceId === w.id && c.status === 'running')
  const unread = s.chats.some((c) => c.workspaceId === w.id && c.unread)
  const asking = s.chats.some((c) => c.workspaceId === w.id && (s.permissions[c.id]?.length ?? 0) > 0)
  const blocker = s.chats.some((c) => c.workspaceId === w.id && c.advisorBlocker)
  const pr = usePrState(w, s.repos.find((r) => r.id === w.repoId))
  const slot = usePaneSlot(w.id)
  return (
    <div
      role="button"
      tabIndex={0}
      {...hover.rowProps}
      draggable={!editing}
      onDragStart={(e) => {
        hover.close()
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', w.id)
        useStore.getState().set({ drag: { kind: 'ws', wsId: w.id } })
        dnd?.start()
      }}
      onDragOver={(e) => {
        if (!dnd?.drag) return
        const r = e.currentTarget.getBoundingClientRect()
        if (dnd.over(e.clientY > r.top + r.height / 2)) {
          e.preventDefault()
          e.stopPropagation()
        }
      }}
      onDrop={(e) => {
        if (!dnd?.drag) return
        e.preventDefault()
        e.stopPropagation()
        dnd.drop()
        dnd.end()
      }}
      onDragEnd={() => {
        useStore.getState().set({ drag: null })
        dnd?.end()
      }}
      onContextMenu={(e) => {
        e.preventDefault()
        hover.close()
        setMenuAt({ x: e.clientX, y: e.clientY })
      }}
      onClick={(e) => {
        if (editing) return
        hover.close()
        if (e.metaKey) return showView(viewFor(w.id), 'right')
        s.selectWorkspace(w.id)
      }}
      onKeyDown={(e) => !editing && e.key === 'Enter' && s.selectWorkspace(w.id)}
      className={`group flex h-9 w-full cursor-default items-center gap-2 rounded-md pr-2 ${repoName ? 'pl-2' : 'pl-5'} text-left ${s.selectedWs === w.id && s.panesShown ? 'bg-raised text-fg' : slot ? 'bg-hover/70 text-fg' : 'text-muted hover:bg-hover hover:text-fg'} ${dropLine} ${dnd?.drag?.id === w.id ? 'opacity-50' : ''}`}
    >
      {running || naming ? <span className="h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-faint border-t-accent" /> : w.orchestrator ? <IconOrchestrator className="shrink-0" /> : w.stack ? <IconStack className="shrink-0 text-accent" /> : pr?.state === 'MERGED' ? (
        <span className="flex shrink-0" title={`#${pr.number} is merged`}><IconMerged className="text-violet-400" /></span>
      ) : pr?.state === 'OPEN' && pr.reviewDecision === 'APPROVED' ? (
        <span className="flex shrink-0" title={`#${pr.number} is approved`}><IconBranch className="text-add" /></span>
      ) : (
        <IconBranch className="shrink-0" />
      )}
      {editing ? (
        <input
          autoFocus
          defaultValue={w.title}
          maxLength={80}
          aria-label="Workspace name"
          onFocus={(e) => e.currentTarget.select()}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') rename(e.currentTarget.value)
            if (e.key === 'Escape') setEditing(false)
          }}
          onBlur={(e) => rename(e.currentTarget.value)}
          className="min-w-0 flex-1 rounded border border-line bg-bg px-1 text-fg outline-none focus:border-accent"
        />
      ) : (
        <span className={`flex-1 truncate ${unread ? 'font-semibold text-fg' : ''} ${naming ? 'text-faint' : ''}`} onDoubleClick={() => !w.orchestrator && setEditing(true)}>
          {w.title}
        </span>
      )}
      {repoName && <span className="shrink-0 truncate text-[11px] text-faint">{repoName}</span>}
      {slot && <PaneSlotIcon slot={slot} />}
      {asking ? (
        <span className="anim-glow shrink-0 rounded bg-accent/20 px-1 text-[10px] text-accent">needs you</span>
      ) : blocker ? (
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-del" title="The advisor raised a blocker" />
      ) : (
        unread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent shadow-[0_0_6px_var(--color-accent)]" />
      )}
      {!w.orchestrator && (
        <>
          <span className="group-hover:hidden">
            <Stats stats={s.stats[w.id]} />
          </span>
          <AddonActions place="workspace-row" repoId={w.repoId} workspaceId={w.id} className="hidden p-0.5 text-faint group-hover:block hover:bg-raised" before={hover.close} />
          <button
            className="hidden shrink-0 rounded p-0.5 text-faint group-hover:block hover:bg-raised hover:text-fg"
            title="Archive workspace"
            onClick={(e) => {
              e.stopPropagation()
              hover.close()
              void archiveWorkspace(w.id)
            }}
          >
            <IconArchive width={15} height={15} />
          </button>
        </>
      )}
      {hover.rect && !w.orchestrator && !editing && !menuAt && !dnd?.drag && <WorkspacePreviewCard ws={w} rect={hover.rect} cardProps={hover.cardProps} onClose={hover.close} />}
      {/* React events bubble out of the portal; keep menu clicks from also selecting the row. */}
      {menuAt && (
        <span onClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.stopPropagation()}>
          <Menu anchor={null} at={menuAt} items={w.orchestrator ? menuItems : [...prMenuItems(pr), ...menuItems]} onClose={() => setMenuAt(null)} />
        </span>
      )}
    </div>
  )
}

type View = { group: 'project' | 'none'; sort: WorkspaceSort; filteredOut: string[] }
const VIEW_KEY = 'sidebar-view'
function loadView(): View {
  const d: View = { group: 'project', sort: 'newest', filteredOut: [] }
  try {
    return { ...d, ...JSON.parse(localStorage.getItem(VIEW_KEY) ?? '{}') }
  } catch {
    return d
  }
}

/** The GitHub owner's avatar when the project is on GitHub, otherwise the plain repo icon. */
export function RepoIcon({ repo }: { repo: Repo }) {
  const [failed, setFailed] = useState(false)
  if (!repo.githubOwner || failed) return <IconRepo className="shrink-0 text-faint" />
  return <img src={`https://avatars.githubusercontent.com/${repo.githubOwner}?s=40`} alt="" title={repo.githubOwner} onError={() => setFailed(true)} className="h-4 w-4 shrink-0 rounded-[4px]" />
}

/** Shown under a project whose choo-choo.json asks for add-ons that aren't on yet. */
function PinRow({ repoId }: { repoId: string }) {
  const pin = useStore((s) => s.addonPins.find((p) => p.repoId === repoId))
  const dismissed = useStore((s) => s.settings.addonPinsDismissed?.[repoId])
  const addons = useStore((s) => s.addons)
  const todo = pinsToSetUp(pin, addons, dismissed)
  if (!todo.length) return null
  const required = todo.some((a) => a.required)
  return (
    <button
      title={`This project's choo-choo.json asks for ${todo.map((a) => a.name).join(', ')}`}
      onClick={() => useStore.getState().set({ modal: 'settings', settingsTab: 'addons' })}
      className={`flex h-9 w-full items-center gap-2 rounded-md pr-2 pl-5 text-left hover:bg-hover ${required ? 'text-amber-400' : 'text-muted hover:text-fg'}`}
    >
      <IconAddon className="shrink-0" />
      <span className="flex-1 truncate">{required ? `Set up ${todo.length === 1 ? todo[0].name : `${todo.length} add-ons`}` : `${todo.length === 1 ? todo[0].name : `${todo.length} add-ons`} suggested`}</span>
    </button>
  )
}
