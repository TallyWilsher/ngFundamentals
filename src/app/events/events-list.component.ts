import { Component } from '@angular/core'

@Component ({
    selector: 'events-list',
    template: `
    <div>
    <h1>Upcoming Angular Events</h1>
    <hr>
    <event-thumbnail [event]="event1"></event-thumbnail>
    </div>
    ` 
})

//ythis is a change
export class EventListComponent {
    event1 = { 
        id: 1,
        name: 'Angluar Connect',
        date: '9/26/2036',
        time: '10:00 am',
        price: 599.99,
        imagesUrl: '/assets/images/angularconnect-shield.png',
        location: {
            address: '1075 DT',
            city: 'London',
            country: 'England'
        }
    }
}