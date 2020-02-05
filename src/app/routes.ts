import { Routes } from "@angular/router";

import { 
    EventsListComponent,
    EventDetailsComponent,
    CreateEventComponent,
    EventRouteActivator,
    EventsListResolver
 } from './events/index';

 import { Error404Component } from './errors/404.component';

import {  } from "./events/events-list.component";
import {  } from "./events/events-details/event-details.component";
import {  } from './events/create-event.component';

import {  } from './events/events-details/event-route-activator.service';
import {  } from './events/events-list-resolver.service';

export const appRoutes:Routes = [
    { path: 'events/new', component: CreateEventComponent,
        canDeactivate: ['canDeactivateCreateEvent'] },
    { path: 'events', component: EventsListComponent, resolve: 
        {events:EventsListResolver} },
    { path: 'events/:id', component: EventDetailsComponent,
        canActivate: [EventRouteActivator] },
    { path: '404', component: Error404Component},
    { path: '',redirectTo: '/events', pathMatch: 'full' },
    { path: 'user', loadChildren: './user/user.module#UserModule'}
]