import { Component } from "@angular/core";
import { Router } from '@angular/router';
import { AuthService } from './auth.service';

@Component({
    templateUrl: './login.component.html',
    styles: [`
        em { float:right; color: #E05C65; padding-left: 10px; }
    `]
})
export class LoginComponent {
    username
    password
    mouseoverLogin

    constructor(private authService: AuthService, private route:Router) {

    }
    
    login(formValues) {
        this.authService.loginUser(formValues.userName, formValues.password)
        this.route.navigate(['events'])
    }

    cancel() {
        this.route.navigate(['events'])
    }
}