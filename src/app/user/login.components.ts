import { Component } from "@angular/core";
import { Router } from '@angular/router';
import { AuthService } from './auth.service';

@Component({
    templateUrl: './login.component.html'
})
export class LoginComponent {
    username
    password

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