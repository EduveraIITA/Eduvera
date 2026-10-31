import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import type { AuthUser } from '../common/request.js';
import { FacilitiesService } from '../facilities/facilities.service.js';
import { CampusScenesService } from '../campus-scenes/campus-scenes.service.js';
import { CampusEventsService } from '../campus-events/campus-events.service.js';
import { eventWorkHref, relationshipEventHref } from '../workspace/canonical-application-links.js';
import { CampusPersonalService } from './campus-personal.service.js';
import { CampusViewRepository } from './campus-view.repository.js';
import type { CampusOperationalActivity, CampusOperationsProjection } from './campus-operations.contracts.js';

const query = z.object({ campus_id: z.uuid() }).strict();
/** Member composition over public geometry and exact owning-domain access.
 * This never invokes the administrator's Campus View evidence projection. */
@Injectable()
export class CampusOperationsService {
  constructor(private readonly personal: CampusPersonalService, private readonly scenes: CampusScenesService,
    private readonly facilities: FacilitiesService, private readonly events: CampusEventsService, private readonly repository: CampusViewRepository) {}

  async view(user: AuthUser, school: string, raw: unknown): Promise<CampusOperationsProjection> {
    const parsed = query.safeParse(raw);
    if (!parsed.success || !z.uuid().safeParse(school).success) {
      throw new BadRequestException('Choose a campus. Map activities do not accept a person, clock or world override.');
    }
    const campus = parsed.data.campus_id;
    // Resolves current canonical identity and server-selected clock/world first.
    const own = await this.personal.mine(user, school, { campus_id: campus });
    const states = await this.scenes.resourceStates(user, school, campus);
    const signals = await this.facilities.mapSignals(user, school, campus, states.items.map(item => item.holding_id));
    const assets = states.items.map(item => {
      const signal = signals.find(entry => entry.holding_id === item.holding_id);
      return { element_id: item.element_id, holding_id: item.holding_id, name: item.name, asset_tag: item.asset_tag,
        space_id: item.space_id, native_state: item.state, reportable: item.reportable,
        signal: { state: signal?.state ?? 'unknown' as const, impact: signal?.impact ?? null,
          open_reports: signal?.open_reports ?? 0, updated_at: signal?.updated_at ?? null }, repairs: signal?.repairs ?? [] };
    });
    const activities: CampusOperationalActivity[] = own.destinations.filter(item => item.kind !== 'responsibility' && item.kind !== 'repair').map(item => ({
      id: item.id, layer: item.kind === 'teaching_session' ? 'classes' : 'events',
      title: item.title, detail: item.detail, space_id: item.space_id,
      holding_id: null,
      starts_at: item.starts_at, ends_at: item.ends_at, state: item.state, target_path: item.target_path,
      action_label: item.action_label, dimension: item.dimension, source: item.source,
    }));
    // Maintenance gets its own bound; a busy teaching day must not consume all
    // destinations before a person's assigned repair work can be considered.
    const work = await this.facilities.work(user,school,{campus_id:campus});
    const ownedWork=work.needs_me.filter(item=>item.owner.user_id===user.id);
    const campusPlaces = new Set((await this.repository.spaces(school,campus)).map(place=>place.id));
    for(const entry of ownedWork.slice(0,20)){
      try{
        const repair=await this.facilities.detail(user,school,entry.repair_id);
        if(repair.recovery_only||repair.access_transferred||repair.state==='closed'||repair.space_id&&!campusPlaces.has(repair.space_id))continue;
        const id=`repair:${repair.id}`;
        if(activities.some(item=>item.id===id))continue;
        activities.push({id,layer:'maintenance',title:repair.title,detail:entry.title,space_id:repair.space_id,
          holding_id:assets.some(asset=>asset.holding_id===repair.holding_id)?repair.holding_id:null,
          starts_at:null,ends_at:null,state:repair.state,target_path:entry.href,action_label:entry.action==='verify'?'Check repair':'Open repair',
          dimension:'accepted',source:{domain:'facilities',record_id:repair.id,revision:repair.revision,label:'Assigned repair'}});
      }catch(error){if(error instanceof ForbiddenException||error instanceof NotFoundException)continue;throw error;}
    }
    // Existing Events owner scopes this before list/detail; copy only the minimal
    // authorized title/time/place/link, never rosters, consent, money or staff.
    const until = new Date(Date.parse(own.as_of) + 7 * 86_400_000).toISOString();
    const visible = await this.events.list(user, { school_id: school, campus_id:campus, from: own.as_of, to: until, status: 'published', limit: '30' });
    const knownPlaces = campusPlaces;
    for (const event of visible.items) {
      if (event.status !== 'published') continue;
      const family = event.viewer_participants[0];
      const href = family && (user.role === 'student' || user.role === 'parent')
        ? relationshipEventHref(user.role === 'student' ? 'self' : 'dependent', family.student_id, event.id)
        : eventWorkHref(user.role === 'admin' ? 'manage' : 'assigned', event.id);
      for (const session of event.sessions) {
        if (Date.parse(session.ends_at) <= Date.parse(own.as_of)) continue;
        const place = session.use_event_space ? event.space_id : session.space_id;
        // A canonical place in another campus is excluded, never relabelled.
        // An authorized unmapped venue remains explicitly unplaced.
        if (place && !knownPlaces.has(place)) continue;
        activities.push({ id: `event:${event.id}:${session.id}`, layer: 'events', title: session.title,
          detail: event.title, space_id: place, holding_id: null, starts_at: session.starts_at, ends_at: session.ends_at,
          state: Date.parse(session.starts_at) <= Date.parse(own.as_of) ? 'in_progress' : 'upcoming', target_path: href,
          action_label: 'Open event', dimension: 'expected', source: { domain: 'events', record_id: event.id,
            revision: event.revision, label: 'Published event' } });
      }
    }
    const sorted = activities.sort((a, b) => (a.starts_at ?? '').localeCompare(b.starts_at ?? '') || a.id.localeCompare(b.id));
    const bounded = (['classes', 'events', 'maintenance'] as const).flatMap(layer => sorted.filter(item => item.layer === layer).slice(0, 20));
    const limitations = ['Schedules show expected activity, not measured presence.',
      'Asset faults are explicit reports. Work reported complete still needs the configured verification.',
      'Resource availability and verified repair closure do not certify that an asset is currently working.'];
    if (bounded.some(item => !item.space_id && !item.holding_id)) limitations.push('Some authorized activities have no reviewed map location yet.');
    if (visible.next_cursor || sorted.length > bounded.length || ownedWork.length>20) limitations.push('This map shows a bounded selection; open the owning area for the complete authorized list.');
    return { schema_version: 1, school_id: school, campus_id: campus, as_of: own.as_of, environment: own.environment,
      publication:states.publication,assets, activities: bounded, bounds:{activities_per_layer:20,events_source_limit:30,events_has_more:Boolean(visible.next_cursor),
        shown:{classes:bounded.filter(item=>item.layer==='classes').length,events:bounded.filter(item=>item.layer==='events').length,
          maintenance:bounded.filter(item=>item.layer==='maintenance').length}}, limitations };
  }
}
