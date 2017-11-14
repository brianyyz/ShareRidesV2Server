//  constants for the parse triggers

var constants = {
    informAdminFlag:                    true,
    debugToConsoleFlag:                 false,
    //FIXME: - Need to add console stmts to triggers and functions that use this flag
    objectIdName:                       'objectId',
    usersRelationName:                  'users',
    userFieldName:                      'user',
    userNameName:                       'username',
    userAutoApproveName:                'autoApproveRequests',
    roleNameKey:                        'name',
    teamName:                           'team',
    teamNameName:                       'teamName',
    roleName:                           'generalUser',
    ridesClassName:                     'Rides',
    rideOwnerDisplayName:               'rideOwnerDisplayname',
    rideOwnerIdName:                    'rideOwnerId',
    ridesDateName:                      'rideDate',
    ridesSeatsName:                     'seatsInCar',
    ridesInPastError:                   'The server could not save your Ride because the date and time cannot be in the past',
    ridesTooFewSeatsError:              'The server could not save your Ride because it needs to have at least 1 seat available.',
    ridesTooManySeatsError:             'The server could not save your Ride because it has more than the maximum number of seats available (5).',
    ridesMinSeats:                      1,
    ridesMaxSeats:                      5,
    ridesTimeZoneName:                  "ownerTimeZoneName",
    ridesOriginDescriptionName:         "originDescription",
    ridesOriginNotesName:               "originNotes",
    ridesDestinationDescriptionName:    "destinationDescription",
    requestsClassName:                  "Requests",
    requestsRideIdName:                 "rideId",
    requestsOwnerIdName:                "requestOwnerId",
    requestsRideOwnerIdName:            "rideOwnerId",
    requestsRideDeletedName:            "rideDeleted",
    requestsOwnerDisplayNameName:       "requestOwnerDisplayName",
    requestsRequestApprovedName:        "requestApproved",
    requestsManualAddName:              "manualAdd",
    teamsClassName:		                "Teams",
    teamRequestsClassName:		        "TeamRequests",
    teamRequestsTeamIdName: 	        "teamId",
    teamRequestsAutoApproveRequestsName: 	"teamAutoApproveRequests",
    teamRequestsOwnerIdName:            "requestOwnerId",
    teamRequestsRequestApprovedName:    "requestApproved",
    teamRequestsTeamOwnerIdName:        "teamOwnerId",
    userHasNoTeamError:                 'You have to join a Team before you can add a Ride',
    channelKeyName:                     "channels",
    channelAdminName:                   "admin",
    channelNewRide:                     'newRide',
    channelChangedRide:                 'changedRide',
    channelDeletedRide:                 'deletedRide',
    channelSilentContent:               'silentContent',
    channelSomeoneShares:               'someoneShares',
    channelUserMessages:                'userMessages',
    rideNotificationsExpiryInterval:    3600,
    requestNotificationExpiryInterval:  300,
    dateFormatString:                   'ddd d mmm hh:MM TT',
    momentDateFormatString:             'ddd, MMM Do, h:mm A z',
    momentDefaultTimeZoneName:          'Europe/London',
    systemStatusClassName:              'SystemStatus'
};
// ride push notifications expire after one hour
// request push notifications expire after 5 minutes
// although expiration is not implemented in parse server yet

//=================================================
// This trigger runs after the save of a _User and adds the user to the
// Role that controls access to the data for the application. Without this Role
// there is no access to the data e.g. public access. This is triggered after any
// change to User - not just creation.
//=================================================
// MARK: - User afterSave

Parse.Cloud.afterSave(Parse.User, function(request) {
    var query = new Parse.Query(Parse.Role);
    query.equalTo(constants.roleNameKey, constants.roleName);

    if (!request.object.existed()) {
        var messageToSend = "New User created"; 
        sendToAdminChannel(messageToSend); 
        if (constants.debugToConsoleFlag) {
            console.log("**DEBUG** User: afterSave: New user created " + request.object.id);
        }
    }

    query.first ( { useMasterKey: true } ).then(function(role) {
        if (role) {
            if (constants.debugToConsoleFlag) {
                console.log("**DEBUG** User: afterSave: Found role. Adding user " + request.user.id);
            }
            role.relation(constants.usersRelationName).add(request.user);
            return role.save(null, {useMasterKey: true});
        } else {
            // answer set was returned but it is empty - arguably this should never occur
            console.error("**ERROR** User: afterSave: ROLE WAS NOT RETURNED.");
            var messageToSend = "User: afterSave: Role was not returned in query. Could not add " + request.user.id; 
            sendToAdminChannel(messageToSend); 
            return Parse.Promise.Error("User: afterSave: Role was not returned.");
        }
    },
    function(error) {
        // serious system error here - inform admin channel - again should never occur
        console.error('**ERROR** User: After Save: Error retrieving the Role for User ' + request.user.id + ' Error: ' + error.code + " : " + error.message);
        var messageToSend = "User: afterSave: Error retrieving Role. Could not add " + request.user.id; 
        sendToAdminChannel(messageToSend); 
    });
});

//=================================================
// This trigger runs before the save of an Installation object. It adds the
// currently logged in user from the client to the Installation to support users
// who use multiple devices so they get alerts on all of their devices.
//
// NOTE - this trigger is called each time Installation is updated e.g. Badges
// which means that the user associated with the installation can change if needed
// just by logging out and back in with the new user name.
//=================================================
// MARK: - Installation beforeSave

Parse.Cloud.beforeSave(Parse.Installation, function(request, response) {
    if (request.user) {
        // Add a pointer to the Parse.User object in a "user" column. 
        request.object.set(constants.userFieldName, request.user);
        if (constants.debugToConsoleFlag) {
            console.log("**DEBUG** Installation: beforeSave: Adding user " + request.user.id);
        }
    } else {
        // if cloud code updates the Installation it won't have a "user"
        if (constants.debugToConsoleFlag) {
            console.log("**DEBUG** Installation: beforeSave: Request has no user associated to it");
        }
    }
    response.success();
});

//=================================================
// This trigger validates the content of the new or updated Ride before saving it
// Sanity check on the number of seats e.g. >0 and <6, date in the future. Avoids
// a bad client code submitting crap data. Also looks at the user's team as 
// recorded on _Installation. Populate the new Rides team field with this value.
//=================================================
// MARK: - Rides beforeSave

Parse.Cloud.beforeSave(constants.ridesClassName, function(request, response) {

    var user = request.object.get(constants.rideOwnerIdName);

    // notify admin users of new ride
    if (!request.object.existed()) {
        var messageToSend = "New Ride created by " + user.id; 
        sendToAdminChannel(messageToSend); 
        if (constants.debugToConsoleFlag) {
            console.log("**DEBUG** Rides: beforeSave: Start creating new Ride for " + user.id);
        }
    }
                            
    var query = new Parse.Query(Parse.Installation);
    query.equalTo(constants.userFieldName, user);
    query.first({ useMasterKey: true }).then(function(installation) {

        var team;
        var rideDate = request.object.get(constants.ridesDateName);
        var dateNow = Date();
        var validationError = false;
        var validationErrorCode = 0;
        var validationString = "";

        // guard against empty query result which will mean that there is no Installation
        // for the user creating the Ride and Ride will not have a Team
        // arguably this is an error condition but not clear what the behaviour should 
        // be for server and client.
        if (installation) {
            team = installation.get(constants.teamName);
        } else {
            if (constants.debugToConsoleFlag) {
                console.log("**DEBUG** Rides: beforeSave: No installation found for user " + request.user.id);
            }
        }

        // make sure the Ride the client sent is valid
        if(dates.compare(dateNow, rideDate) > 0) {
            validationError = true;
            validationErrorCode = 601;
            validationString = constants.ridesInPastError;
            if (constants.debugToConsoleFlag) {
                console.log("**DEBUG** Rides: beforeSave: Validation fails - Ride date is in the past");
            }
        }
        if (request.object.get(constants.ridesSeatsName) < constants.ridesMinSeats) {
            validationError = true;
            validationErrorCode = 602;
            validationString = constants.ridesTooFewSeatsError;
            if (constants.debugToConsoleFlag) {
                console.log("**DEBUG** Rides: beforeSave: Validation fails - Too few seats");
            }
        }
        if (request.object.get(constants.ridesSeatsName) > constants.ridesMaxSeats) {
            validationError = true;
            validationErrorCode = 603;
            validationString = constants.ridesTooManySeatsError;
            if (constants.debugToConsoleFlag) {
                console.log("**DEBUG** Rides: beforeSave: Validation fails - Too many seats");
            }
        }

        // if the Ride already existed then don't make any change to the Team that
        // is on it. If it is new then copy the Team from the User creating it
        // corner case here if installation was not returned then Ride won't have a Team
        if (!request.object.existed()) {
            if (team) {
                request.object.set(constants.teamName, team);
            }
        }

        // go ahead and save if there are no validation errors
        if (validationError == false) {
            if (constants.debugToConsoleFlag) {
                console.log("**DEBUG** Rides: beforeSave: Validation passed");
            }
            response.success();
        } else {
            console.log("**Error** Rides: beforeSave: Validation failed. Ride not saved.");
            response.error(validationErrorCode, validationString);
        }
    },
    function(error) {
        validationString = "Rides: beforeSave: Query Error finding Installation for this user " + error.code + ": " + error.message;
        validationErrorCode = 609;
        console.error("**ERROR** " + validationString);
        response.error(validationErrorCode, validationString);
    });
});

//=================================================
// This trigger runs after successful save of a Ride (new or changed). It
// notifies all of the subscribers to the new or changed channel of a new Ride
// or a change to an existing Ride except the user who created/ownes it
//=================================================
// MARK: - Rides afterSave

Parse.Cloud.afterSave(constants.ridesClassName, function(request) {

    var moment          = require('moment');
    var tz              = require('moment-timezone');
                      
    var dateNow         = Date();
    var channelString   = "";
    var alertTitleKey   = "";
                      
    var user            = request.user;
                      
    var rideOrigin      = request.object.get(constants.ridesOriginDescriptionName);
    var rideDestination = request.object.get(constants.ridesDestinationDescriptionName);
    var rideDate        = request.object.get(constants.ridesDateName);
    var rideTimeZone    = request.object.get(constants.ridesTimeZoneName);
    var rideTeam        = request.object.get(constants.teamName);
    var rideNotes       = request.object.get(constants.ridesOriginNotesName);

    if ((rideTimeZone == "") || (rideTimeZone === undefined)) {
        rideTimeZone = constants.momentDefaultTimeZoneName;
    }

    var rideDate2       = moment.tz(rideDate, rideTimeZone).format(constants.momentDateFormatString);    

    // if the date is in in the future then proceed otherwise log and exit
    if (dates.compare(dateNow, rideDate) < 0) {
    
        var queryIOS = new Parse.Query(Parse.Installation);
        queryIOS.equalTo('deviceType', 'ios');
        queryIOS.equalTo(constants.channelKeyName, constants.channelSilentContent);
        // if the team is set on the Ride then only send notification to Installations
        // with that same Team
        if ((rideTeam != "") && (rideTeam !== undefined)) {
            queryIOS.equalTo(constants.teamName, rideTeam);
        } else {
            queryIOS.doesNotExist(constants.teamName);
        }

        Parse.Push.send({
            //expiration_interval: constants.rideNotificationsExpiryInterval,
            where: queryIOS,
            data: {
                refresh: constants.ridesClassName,
                'content-available': 1
            }
        }, { useMasterKey: true }).then(function() {

            if (request.object.existed()) {
                // this is a change to an existing Ride so only notify those who have requested it
                // if the Ride is in the future and whose team matches the Team on the Ride
                if (constants.debugToConsoleFlag) {
                    console.log("**DEBUG** Rides: afterSave: existing Ride notifying those with Requests");
                }

                var alertString = "Ride from " + rideOrigin + " to " + rideDestination + " has changed - " + rideDate2;
                channelString = constants.channelChangedRide;
                alertTitleKey = "2";
                if (rideNotes.length > 0) {
                    alertString = alertString + " Notes: " + rideNotes
                }

                // find all the requests that relate to this Ride
                var changeQuery = new Parse.Query(constants.requestsClassName);
                changeQuery.equalTo(constants.requestsRideIdName, request.object);

                return changeQuery.each(function(notifyThisOne) {
                    var requestUser = notifyThisOne.get(constants.requestsOwnerIdName);
                    var notifyChangedRequestsQuery = new Parse.Query(Parse.Installation);
                    notifyChangedRequestsQuery.equalTo(constants.userFieldName, requestUser);
                    
                    var requestUserName = notifyThisOne.get(constants.requestsOwnerDisplayNameName);

                    return Parse.Push.send({
                        where: notifyChangedRequestsQuery,
                        expiration_time: rideDate,
                        data: {
                            alert: alertString,
                            badge: 1,
                            refresh: constants.requestsClassName,
                            "key": alertTitleKey
                        }
                    }, { useMasterKey: true });
                }, { useMasterKey: true });

            } else {
                // this is a new Ride so notify those on the new channel if the Ride is in the future
                if (constants.debugToConsoleFlag) {
                    console.log("**DEBUG** Rides: afterSave: new Ride notifying those with same Team and channel");
                }

                var alertString = "New Ride from " + rideOrigin + " to " + rideDestination + " - " + rideDate2;
                alertTitleKey = "1";
                if (rideNotes.length > 0) {
                    alertString = alertString + " Notes: " + rideNotes
                }

                // UI visible alert goes to devices subscribing to the newRide channel
                // except the user that did the add / change
                var addQuery = new Parse.Query(Parse.Installation);
                var ridePointer = request.object.get(constants.rideOwnerIdName);
                addQuery.equalTo(constants.channelKeyName, constants.channelNewRide);
                addQuery.notEqualTo(constants.userFieldName, ridePointer);
                
                // if the team is set on the Ride then only send notification to Installations
                // with that same Team
                if ((rideTeam != "") && (rideTeam !== undefined)) {
                    addQuery.equalTo(constants.teamName, rideTeam);
                } else {
                    addQuery.doesNotExist(constants.teamName);
                }

                return Parse.Push.send({
                    expiration_time: rideDate,
                    where: addQuery,
                    data: {
                        alert: alertString,
                        badge: 1,
                        "key": alertTitleKey
                    }
                }, { useMasterKey: true });
            }
        }, function(e) {
            console.error("**ERROR** Rides: afterSave: Error in trigger - new ride push to new ride channel" + error.code + " : " + error.message);
        });
    } else {
        if (constants.debugToConsoleFlag) {
            console.log("**DEBUG** Rides: afterSave: Ride date is in the past - exiting");
        }
    }
});

//=================================================
// This trigger runs before the deletion of a Ride.
// It marks each Request linked to the Ride with a flag
// to prevent the Ride owner from receiving multiple alerts
// that the people who had requested that ride have cancelled their
// request. Flag is checked in Requests 
//=================================================
// MARK: - Rides beforeDelete
Parse.Cloud.beforeDelete(constants.ridesClassName, function(request, response) {
    var requestsQuery = new Parse.Query(constants.requestsClassName);
    requestsQuery.equalTo(constants.requestsRideIdName, request.object);
    if (constants.debugToConsoleFlag) {
        console.log("**DEBUG** Rides: beforeDelete: tag Requests with rideDeleted");   
    }

    requestsQuery.find({ useMasterKey: true }).then(function(results) {
        if (constants.debugToConsoleFlag) {
            console.log("**DEBUG** Rides: beforeDelete: found " + results.length + " requests to tag as deleted");   
        }
        var promise = Parse.Promise.as();
        for(var i=0; i<results.length; i++){
            results[i].set(constants.requestsRideDeletedName, true);
            promise = promise.then(function() {
                // Return a promise that will be resolved when the save is finished.
                return results[i].save(null, { useMasterKey: true });
            }); 
            return promise;
        }
    }).then(function() {
        if (constants.debugToConsoleFlag) {
            console.log("**DEBUG** Rides: beforeDelete: Completed promises and returning success");
        }
        response.success();
    },
    function(error) {
        console.error("**ERROR** Rides: beforeDelete: Error setting the requests ridedeleted flag. Ride is " + request.object.id + " Error is " + error);
        response.error(701, "An error occurred deleting the Ride.", error);
    });
});

//=================================================
// This trigger runs after the delete of a Ride. It runs through all of the Requests
// to identify any Requests for the deleted Ride. It sends an alert to the devices of
// a user that owns the Request and deletes the Request.
// Note that since the rideId is a Pointer that the entire object is passed not just
// the value of the pointer field
//=================================================
// MARK: - Rides afterDelete

Parse.Cloud.afterDelete(constants.ridesClassName, function(request) {

    var moment          = require('moment');
    var tz              = require('moment-timezone');
                        
    var dateNow         = Date();
    var rideDate        = request.object.get(constants.ridesDateName);
                        
    var rideTimeZone    = request.object.get(constants.ridesTimeZoneName);
    
    if ((rideTimeZone == "") || (rideTimeZone === undefined)) {
        rideTimeZone = constants.momentDefaultTimeZoneName;
    }
                        
    var rideDate2 = moment.tz(rideDate, rideTimeZone).format(constants.momentDateFormatString);
    
    // if the Ride is in the past don't send alerts
    if(dates.compare(dateNow, rideDate) < 0) {
        if (constants.debugToConsoleFlag) {
            console.log("**DEBUG** Rides: afterDelete: notifying people with requests for the Ride and deleting Requests");
        }

        var rideOrigin      = request.object.get(constants.ridesOriginDescriptionName);
        var rideDestination = request.object.get(constants.ridesDestinationDescriptionName);
        var rideTeam        = request.object.get(constants.teamName);
        var rideAlertString = "Ride from " + rideOrigin + " to " + rideDestination + " on " + rideDate2 + " has been cancelled by the owner";
        var requestAlertString = "The Ride that you booked from " + rideOrigin + " to " + rideDestination + " on " + rideDate2 + " has been cancelled by the owner";
                        
        // In this section, all of the Requests linked to this Ride are retrieved and a
        // notification is pushed to the user via the Installations table so that they know
        // their Ride has been cancelled by the owner. Whether the notification is visible
        // will depend on the user's settings in IOS
        var requestsQuery = new Parse.Query(constants.requestsClassName);
        requestsQuery.equalTo(constants.requestsRideIdName, request.object);

        return requestsQuery.each(function(notifyThisOne) {
            var requestUserName = notifyThisOne.get(constants.requestsOwnerDisplayNameName)
            var requestUser = notifyThisOne.get(constants.requestsOwnerIdName);
            var notifyDeletedRequestsQuery = new Parse.Query(Parse.Installation);
            notifyDeletedRequestsQuery.equalTo("user", requestUser);

            // now delete the request and notify
            notifyThisOne.destroy({ useMasterKey: true }).then(function() {
                Parse.Push.send({
                    expiration_time: rideDate,
                    where: notifyDeletedRequestsQuery,
                    data: {
                        alert: requestAlertString,
                        badge: 1,
                        refresh: constants.requestsClassName,
                        "key": "3"
                        }
                }, { useMasterKey: true });
            });   
        }, { useMasterKey: true });
    } else {
        if (constants.debugToConsoleFlag) {
            console.log("**DEBUG** Rides: afterDelete: Ride is in the past - no action taken");
        }
    }
});

//=================================================
// This trigger runs before the save of a Request. It checks the value of
// the Ride owner's auto-approve setting and adjusts the status submitted
// on the new Request if needed. In other words if a client tries to submit
// crap data it gets corrected. The trigger is designed to run against a
// new request but it will get triggered when ever a change is made to the
// request so need to check whether it existed or not prior to the save.
// The trigger also validates that there is a seat available in the Ride
// by looking at total requests versus seats available to prevent race
// conditions
//=================================================
// MARK: - Requests beforeSave

Parse.Cloud.beforeSave(constants.requestsClassName, function(request, response) {

    var ridePointer         = request.object.get(constants.requestsRideIdName);
    var rideOwnerPointer    = request.object.get(constants.requestsRideOwnerIdName);
    var requestOwnerPointer = request.object.get(constants.requestsOwnerIdName);
    var totalRequestsQuery = new Parse.Query(constants.requestsClassName);
    totalRequestsQuery.equalTo(constants.requestsRideIdName, request.object.get(constants.requestsRideIdName));
    totalRequestsQuery.equalTo(constants.requestsRequestApprovedName, true);

    var installationQuery = new Parse.Query(Parse.Installation);
    installationQuery.equalTo(constants.userFieldName, request.object.get(constants.requestsOwnerIdName));
    
    if (request.object.existed()) {
        // this request already existed so no further processing is needed
        if (constants.debugToConsoleFlag) {
            console.log("**DEBUG** Requests: beforeSave: Request already exists - no further processing");
        }
        response.success();
    } else if (request.object.get(constants.requestsManualAddName)) {
        // the ride owner is manually adding a Request. Set the Team, approved status and done
        if (constants.debugToConsoleFlag) {
            console.log("**DEBUG** Requests: BeforeSave: Manual add so approve, set team and exit");
        }
        ridePointer.fetch({ useMasterKey: true }).then(function(ride) {
            rideTeam   = ride.get(constants.teamName);
            request.object.set(constants.teamName, rideTeam);
            request.object.set(constants.requestsRequestApprovedName, true);
            response.success();
        });
     } else {
        // process the new Request
        if (constants.debugToConsoleFlag) {
            console.log("**DEBUG** Requests: BeforeSave: New Request - process starts");
        }

        var promises = [];
        promises.push(ridePointer.fetch({ useMasterKey: true }));
        promises.push(rideOwnerPointer.fetch({ useMasterKey: true }));
        promises.push(requestOwnerPointer.fetch({ useMasterKey: true }));
        promises.push(totalRequestsQuery.count({ useMasterKey: true }));
        promises.push(installationQuery.first({ useMasterKey: true }));

        Parse.Promise.when(promises).then(function(results) {
            var valid                   = true;
            var validationString        = "";
            var validationErrorCode     = 0;
            var ride                    = results[0];
            var rideOwner               = results[1];
            var requestOwner            = results[2];
            var totalRequests           = results[3];
            var requestOwnerInstallation = results[4];

            //FIXME: - test that each of the above is present or send response.error

            var seatsInCar = ride.get(constants.ridesSeatsName);
            var rideTeam = ride.get(constants.teamName);
            var userTeam = requestOwnerInstallation.get(constants.teamName);
            if (constants.debugToConsoleFlag) {
                console.log("**DEBUG** Requests: BeforeSave: Ride is " + ride.id);
                console.log("**DEBUG** Requests: BeforeSave: Ride owner is " + rideOwner.id);
                console.log("**DEBUG** Requests: BeforeSave: Request owner is " + requestOwner.id);
                console.log("**DEBUG** Requests: BeforeSave: Total requests for Ride " + totalRequests);
                console.log("**DEBUG** Requests: BeforeSave: request owner installation is " + requestOwnerInstallation.id);
                console.log("**DEBUG** Requests: BeforeSave: seats in car " + seatsInCar);
                console.log("**DEBUG** Requests: BeforeSave: Ride Team is " + rideTeam.id);
                console.log("**DEBUG** Requests: BeforeSave: request owner team is " + userTeam.id);
            }

            // auto approve the request if ride owner's setting is true
            if (rideOwner.get(constants.userAutoApproveName)) {
                request.object.set(constants.requestsRequestApprovedName, true);
            } else {
                request.object.set(constants.requestsRequestApprovedName, false);
            }

            // ensure enough seats in car
            if (totalRequests >= seatsInCar) {
                valid = false;
                validationString = "There are no seats available in the server copy of the Ride requested.";
                validationErrorCode = 801;
            }

            // both teams present and match - set the request Team
            if (((rideTeam) && (userTeam)) && (rideTeam.id === userTeam.id)) {
                request.object.set(constants.teamName, rideTeam);
            } 

            // both teams present and don't match - fail
            if (((rideTeam) && (userTeam)) && (rideTeam.id !== userTeam.id)) {
                valid = false;
                validationString = "Your Team and the requested Ride Team do not match.";
                validationErrorCode = 802;
            }

            // both absent - ok - no need to set request Team

            // only one present = fail
            if (((rideTeam) && (!userTeam)) || ((!rideTeam) && (userTeam))) {
                valid = false;
                validationString = "Your Team and the requested Ride Team do not match.";
                validationErrorCode = 803;
            }

            if (valid) {
                response.success();
            } else {
                console.error("**ERROR** Requests: beforeSave: " + validationString);
                response.error(validationErrorCode, validationString);
            }

        },function(error) {
            validationString = "Unable to retrieve promises results. Error is " + error;
            console.error("**ERROR** Requests: beforeSave: " + validationString);
            validationErrorCode = 804
            response.error(validationErrorCode, validationString);
        });
     }
});

//=================================================
// This trigger runs after the delete of a Request. It simply pushes out a
// silent notification to tell clients to update their data model and 
// copies the Request over the a RequestCancelled
//=================================================
// MARK: - Requests afterDelete

Parse.Cloud.afterDelete(constants.requestsClassName, function(request) {
    
    // silent notification goes to all clients to cause refresh of dataModel
    var queryIOS = new Parse.Query(Parse.Installation);
    var rideTeam = request.object.get(constants.teamName);
    queryIOS.equalTo('deviceType', 'ios');
    queryIOS.equalTo(constants.channelKeyName, constants.channelSilentContent);
    if ((rideTeam != "") && (rideTeam !== undefined)) {
        queryIOS.equalTo(constants.teamName, rideTeam);
    } else {
        queryIOS.doesNotExist(constants.teamName);
    }

    return Parse.Push.send({
        where: queryIOS,
        expiration_interval: constants.requestNotificationsExpiryInterval,
        data: {
            refresh: constants.requestsClassName,
            'content-available': 1
            }
    }, { useMasterKey: true }).then(function() {

        // if the Request is being deleted as the result of a Ride being
        // deleted then create a copy of it. If it is not it is being
        // deleted by a client in which case it is copied by the client
        // code
        var CancelledRequests       = Parse.Object.extend("RequestsCancelled");
        var cancelledRequest        = new CancelledRequests();
        var rideDeleted             = request.object.get("rideDeleted");

        if (rideDeleted) {
            var requestApproved         = request.object.get("requestApproved");
            var requestOwnerDisplayName = request.object.get("requestOwnerDisplayName");
            var rideId                  = request.object.get("rideId");
            var rideOwnerId             = request.object.get("rideOwnerId");
            var manualAdd               = request.object.get("manualAdd");
            var team                    = request.object.get("team");
            var requestDate             = request.object.get("requestDate");
            var requestOwnerId          = request.object.get("requestOwnerId");

            cancelledRequest.set("rideDeleted",             rideDeleted);
            cancelledRequest.set("requestApproved",         requestApproved);
            cancelledRequest.set("requestOwnerDisplayName", requestOwnerDisplayName);
            cancelledRequest.set("rideId",                  rideId);
            cancelledRequest.set("rideOwnerId",             rideOwnerId);
            cancelledRequest.set("manualAdd",               manualAdd);
            cancelledRequest.set("team",                    team);
            cancelledRequest.set("requestDate",             requestDate);
            cancelledRequest.set("requestOwnerId",          requestOwnerId);

            return cancelledRequest.save(null, {useMasterKey: true});
        } else {
            return Parse.Promise.as("Continue");
        }

    }).then(function() {

        // Notify the Ride owner of the cancelled Request unless the owner has
        // cancelled the Ride which is causing the cascading Request delete
        var rideDeleted = request.object.get(constants.requestsRideDeletedName);
        if (!rideDeleted) {
            var requesterName = request.object.get(constants.requestsOwnerDisplayNameName);
            var notifyShareAlertQuery = new Parse.Query(Parse.Installation);
            var notifyShareAlertString = "FYI " + requesterName + " has cancelled their Request to join your Ride.";
            notifyShareAlertQuery.equalTo(constants.userFieldName, request.object.get(constants.rideOwnerIdName));
            notifyShareAlertQuery.equalTo(constants.channelKeyName, constants.channelSomeoneShares);

            Parse.Push.send({
                where: notifyShareAlertQuery,
                data: {
                    alert: notifyShareAlertString,
                    badge: 1,
                    "key": "9"
                }
            }, { useMasterKey: true });            
        }
    },
    function(e) {
        console.error("**ERROR** Requests: after Delete: Failed sending notifications to Ride owner on Request delete " + error.code + " : " + error.message);
    });
});

//=================================================
// This trigger runs after the save of a Request. It notifies the Ride owner either that the
// Request needs to be approved or FYI that a person has joined their Ride based on their
// auto-approve setting.
//=================================================
// MARK: - Requests afterSave

Parse.Cloud.afterSave(constants.requestsClassName, function(request) {

    // silent notification goes to all clients to cause refresh of Requests dataModel
    var queryIOS = new Parse.Query(Parse.Installation);
    queryIOS.equalTo('deviceType', 'ios');
    queryIOS.equalTo(constants.channelKeyName, constants.channelSilentContent);
    var rideTeam = request.object.get(constants.teamName);
    if ((rideTeam != "") && (rideTeam !== undefined)) {
        queryIOS.equalTo("team", rideTeam);
    } else {
        queryIOS.doesNotExist(constants.teamName);
    }

    Parse.Push.send({
        where: queryIOS,
        data: {
            refresh: constants.requestsClassName,
            'content-available': 1
        }
    }, { useMasterKey: true }).then(function() {

        // If the request approval status is false and the rideDeleted is false then 
        // notify the Ride owner of the request
        if ((request.object.get(constants.requestsRequestApprovedName) == false) && 
            (request.object.get(!constants.requestsRideDeletedName))) {
            var requesterName = request.object.get(constants.requestsOwnerDisplayNameName);
            var notifyOwnerAlertString = requesterName + " has made a request to share your Ride which you need to approve.";
            var notifyOwnerAlertQuery = new Parse.Query(Parse.Installation);
            notifyOwnerAlertQuery.equalTo(constants.teamName, request.object.get(constants.requestsRideOwnerIdName));
                        
            return Parse.Push.send({
                where: notifyOwnerAlertQuery,
                data: {
                    alert: notifyOwnerAlertString,
                    badge: 1,
                    "key": "6"
                }
            }, { useMasterKey: true });
        } 
        if ((request.object.get(constants.requestsRequestApprovedName) == true) && 
            (!request.object.get(constants.requestsRideDeletedName))) {
            var requesterName = request.object.get(constants.requestsOwnerDisplayNameName);
            var notifyShareAlertQuery = new Parse.Query(Parse.Installation);
            var notifyShareAlertString = "FYI " + requesterName + " has joined your Ride.";
            notifyShareAlertQuery.equalTo(constants.userFieldName, request.object.get("rideOwnerId"));
            notifyShareAlertQuery.equalTo(constants.channelKeyName, constants.channelSomeoneShares);

            return Parse.Push.send({
                where: notifyShareAlertQuery,
                data: {
                    alert: notifyShareAlertString,
                    badge: 1,
                    "key": "10"
                }
            }, { useMasterKey: true });
        }
    }, function(e) {
        console.log("**ERROR** Requests: afterSave: Failed sending silent notification refresh requests " + error.code + " : " + error.message);
    });                      
});

//=================================================
// This trigger runs before the save of a TeamRequest. It checks the value of
// the Team's auto-approve setting and adjusts the status submitted
// on the new Request if needed. In other words if a client tries to submit
// crap data it gets corrected. The trigger is designed to run against a
// new request but it will get triggered when ever a change is made to the
// request so need to check whether it existed or not prior to the save.
//=================================================
// MARK: - TeamRequests beforeSave

Parse.Cloud.beforeSave("TeamRequests", function(request, response) {
                       
    var teamQuery = new Parse.Query("Teams");
                       
    if (request.object.existed()) {
        console.log("TeamReqests: Before Save: object already existed - no auto approve processing");
        response.success();
    } else {
        console.log("TeamReqests: Before Save: new object - perform auto approve processing");

        teamQuery.get(request.object.get('teamId').id, { useMasterKey: true } ).then(
            function(team) {
                // Look at the Team’s preference setting for Auto Accept.
                // If it is true (open team) then update the request_approved
                // value to true otherwise override it to false
                // placement in cloud is primarily to protect against malicious
                // client behaviour
                var teamOwner = team.get("teamOwnerId");
                var autoApprove = team.get("teamAutoApproveRequests");
                if ((autoApprove) || (teamOwner.id == request.user.id)) {
                    request.object.set("requestApproved", true);
                    console.log("TeamRequests: Before Save: Team auto approve is true or this is the owner - request approved set true");
                } else {
                    request.object.set("requestApproved", false);
                    console.log("TeamRequests: Before Save: Team owner auto approve is false - request approved set false");
                }
                response.success();
            },
            function(error) {
                    // could not get the  to retrieve the number of seats
                console.log("TeamRequests: Before Save: Unable to retrieve the Team for the autoapprove setting.");
                response.error(error);
            }
        );
    }
});

//=================================================
// This trigger runs after the save of a TeamRequest. The beforeSave trigger will
// change the approved status based on the Team autoApprove setting. A TeamRequest
// save can come from a client creating a new request or from a Team owner approving
// or pending an existing request.
// If the status of the TeamRequest is approved then add the Team to all of the user's
// Installations. The only way a TeamRequest can move to approved is via the TeamRequest
// beforeSave trigger or the Team owner initiated ApproveRequest cloud function so
// this doesn't need any further validation. If the status is not approved then remove
// the Team from all Installations
//=================================================
// MARK: - TeamRequests afterSave

Parse.Cloud.afterSave(constants.teamRequestsClassName, function(request) {
    console.log("TeamRequests: after save: Starting function");
    // get the objects from the request to pass along
    var team = request.object.get(constants.teamRequestsTeamIdName);
    var requestOwner = request.object.get(constants.teamRequestsOwnerIdName);
    var approved = request.object.get(constants.teamRequestsRequestApprovedName);
    var teamOwner = request.object.get(constants.teamRequestsTeamOwnerIdName);
    var operation = "";
    var notifyQuery = new Parse.Query(Parse.Installation);
    notifyQuery.equalTo(constants.userFieldName, requestOwner);
    var notifyTeamOwnerQuery = new Parse.Query(Parse.Installation);
    notifyTeamOwnerQuery.equalTo(constants.userFieldName, teamOwner);
                      
    console.log("TeamRequests: afterSave: value of team id " + team.id + " and request user id " + requestOwner.id + " approved " + approved);

    // if the team request is approved we'll add the Team to the user's Installation otherwise remove it
    if (approved) {
        operation = "A";
    } else {
        operation = "R";
    }

    // Add or remove the team from the user's installations                  
    addRemoveUserTeam({ "team": team, "user": requestOwner, "operation": operation }).then(function() {
        console.log("TeamRequests: afterSave: addRemoveUserTeam " + operation + " success");
        if (approved) {
            return Parse.Push.send({
                where: notifyQuery,
                data: {
                    alert: "Your request to join a team has been approved",
                    badge: 1,
                    "key": "11",
                    'content-available': 1,
                    refresh: "Installation"
                }
            }, {useMasterKey: true});    
        } else {
            return Parse.Push.send({
                where: notifyQuery,
                data: {
                    alert: "Your request to join a team is pending approval by the team owner",
                    badge: 1,
                    "key": "12",
                    'content-available': 1,
                    refresh: "Installation"
                }
            }, {useMasterKey: true});    
        }
    }).then(function() {
        console.log("TeamRequests: afterSave: Sending notification to team owner");
        if (approved) {
            return Parse.Push.send({
                where: notifyTeamOwnerQuery,
                data: {
                    'content-available': 1,
                    refresh: "Installation"
                }
            }, { useMasterKey: true });
        } else {
            return Parse.Push.send({
                where: notifyTeamOwnerQuery,
                data: {
                    alert: "There are requests to join your team waiting for your approval.",
                    badge: 1,
                    'content-available': 1,
                    "key": "12",
                    refresh: "Installation"
                }
            }, { useMasterKey: true }); 
        }
    });
});

// MARK: - Functions

//=================================================
// This function is called by when a Ride owner wants to send a
// push message to all of the users who have a Request to share
// their Ride - for example, if the taxi is delayed or if the
// meeting point has changed. Returns an array of the user names
// to whom the message was sent.
//=================================================
// MARK: - Function sendMessageToPassengers

Parse.Cloud.define("sendMessageToPassengers", function(request, response) {
                   
    console.log("Function: sendMessageToPassengers: Start send to passengers for rideId " + request.params.rideId);
                   
    var messageToSend = "";    

    var requestQuery = new Parse.Query(constants.requestsClassName);
    requestQuery.equalTo(constants.requestsRideIdName, { __type: "Pointer", className: constants.ridesClassName, objectId: request.params.rideId });
    requestQuery.include(constants.requestsOwnerIdName);
    requestQuery.include(constants.requestsRideIdName);
    
    var permissionsQuery = new Parse.Query(Parse.Installation);
    permissionsQuery.matchesKeyInQuery(constants.userFieldName, constants.requestsOwnerIdName, requestQuery);
    permissionsQuery.include(constants.userFieldName);
    permissionsQuery.equalTo(constants.channelKeyName, constants.channelUserMessages);
                   
    var sentToList = [];

    var rideQuery = new Parse.Query(constants.ridesClassName);
    rideQuery.equalTo(constants.objectIdName, request.params.rideId);
    
    rideQuery.first({ useMasterKey: true }).then(function(ride) {
        // guard against empty result set
        if (ride) {
            console.log("Function: sendMessageToPassengers: Found the ride - rideOwnerId is " + ride.get(constants.rideOwnerIdName).id);
            var senderName = ride.get(constants.rideOwnerDisplayName);
            messageToSend = "From " + senderName + ": " + request.params.message;
            console.log("Function: sendMessageToPassengers: Message to send is: " + messageToSend);
            return permissionsQuery.find({ useMasterKey: true });
        } else {
            return Parse.Promise.error("Function: sendMessageToPassengers: Error: Unable to retrieve Ride.");
        }
    }).then(function(installations) {
        for (var i = 0; i < installations.length; i++) {
            var record = installations[i];
            var inst = record.get(constants.userFieldName);
            var targetName = inst.get(constants.userNameName);
            console.log("Function: sendMessageToPassengers: Found userMessage permission for " + targetName);
            sentToList.push(targetName);
        }
        return Parse.Promise.as("Continue");
    }).then(function() {
        return Parse.Push.send({
            where: permissionsQuery,
            data: {
                alert: messageToSend,
                badge: 1,
                "key": "7"
            }
        }, { useMasterKey: true }).then(function() {
            console.log("Function: sendMessageToPassengers: push sent");
            response.success(sentToList);
        }, function(error) {
            console.log("Function: sendMessageToPassengers: push send error " + error);
            response.error("Function: sendMessageToPassengers: Error: error sending push notifications " + error);
        });
    },
    function(error) {
        console.log("Function: sendMessageToPassengers: Error: " + error);
        response.error("Function: sendMessageToPassengers: Error: Unable to find Ride or Installations");
    });
});

//=================================================
// This function is called by when a Ride passenger wants to send a
// push message to the Ride owner
//=================================================
// MARK: Function sendMessageToOwner
Parse.Cloud.define("sendMessageToOwner", function(request, response) {

    var senderName = "";
    var rideOwnerName = "";
    var sentToList = [];

    var rideQuery = new Parse.Query(constants.ridesClassName);
    rideQuery.equalTo(constants.objectIdName, request.params.rideId);

    var permissionsQuery = new Parse.Query(Parse.Installation);

    rideQuery.first({ useMasterKey: true }).then(function(ride) {
        if (ride) {
            // the Ride was found - there is always a possibility a client could have passed an invalid objectId
            rideOwnerName = ride.get(constants.rideOwnerDisplayName);
            console.log("Function: sendMessageToOwner: User " + request.user.id + " sending to Ride " + request.params.rideId + " and the owner is " + rideOwnerName);
            permissionsQuery.equalTo(constants.userFieldName, ride.get(constants.rideOwnerIdName));
            permissionsQuery.equalTo(constants.channelKeyName, constants.channelUserMessages);
            return permissionsQuery.first({ useMasterKey: true });
        } else {
            // the client must have passed an invalid Ride objectId
            return Parse.Promise.error("Function: sendMessageToOwner: Error: The Ride ID was not found.");
        }
    }).then(function(installation) {
        // the ride owner has to have at least one installation that has the userMessages 
        // permission on it.
        if (installation) {
            sentToList.push(rideOwnerName);
            console.log("Function: sendMessageToOwner: The target user " + rideOwnerName + " allows sending messages to them");
            var messageToSend = "From " + request.user.get('username') + ": " + request.params.message;
            console.log("Function: sendMessageToOwner: Sending content: " + messageToSend);
            return Parse.Push.send({
                where: permissionsQuery,
                data: {
                    alert: messageToSend,
                    badge: 1,
                    "key": "8"
                }
            }, { useMasterKey: true }).then(function() {
                console.log("Function: sendMessageToPassengers: push sent");
                response.success(sentToList);
            }, function(error) {
                console.log("Function: sendMessageToPassengers: push send error " + error);
                return Parse.Promise.error("Function: sendMessageToPassengers: Error: error sending push notifications " + error);
            });
        } else {
            console.log("Function: sendMessageToOwner: The target user " + rideOwnerName + " does not allow sending messages to them");
            // even though this is sort of an error condition we return an empty list and the client interprets it
            response.success(sentToList);
        }
    },function(error) {
        console.log("Function: sendToOwner: Error: Unable to find Ride or Installation");
        response.error(error);
    });
});

//=================================================
// This function is called when a Team owner
// has gone in to the Team Members list and approved a pending request. It also notifies the
// Requester of the change in status.
//=================================================
// MARK: Function approvePendingTeamRequest

Parse.Cloud.define("approvePendingTeamRequest", function(request, response) {

    console.log("Function: approvePendingTeamRequest: Start - value of requestId is " + request.params.requestId);

    var query = new Parse.Query("TeamRequests");
    query.equalTo(constants.objectIdName, request.params.requestId);

    query.first({ useMasterKey: true }).then(
        function(requestToApprove) {
            // first condition guards against empty answer set and JS short circuits so won't evaluate remaining && conditions
            if ((requestToApprove) && (requestToApprove.get("requestApproved") == false) && (request.user.id == requestToApprove.get('teamOwnerId').id)) {
                console.log("Function: approvePendingTeamRequest: request is pending and request id matches team owner id. Request owner is " + requestToApprove.get('requestOwnerDisplayName'));
                // update the request status
                console.log("Function: approvePendingTeamRequest: updating the request status");
                requestToApprove.set("requestApproved", true);
                return requestToApprove.save(null, {useMasterKey: true});
            } else {
                // force the promise to fail through to error handler
                console.log("Function: approvePendingTeamRequest: ERROR either request is approved or request id does not matche team owner id.");
                return Parse.Promise.Error("Function: approvePendingTeamRequest: ERROR TeamRequest is already approved or requestor is not the Team owner.");
            }
        }).then(function(requestToApprove) {
            // send out notifications
            console.log("Function: approvePendingTeamRequest: sending out notifications");
            var notifyApprovedQuery = new Parse.Query(Parse.Installation);
            var notifyApprovedAlertString = "Your request to join a ShareRides team has been approved.";
            notifyApprovedQuery.equalTo("user", requestToApprove.get("requestOwnerId"));

            return Parse.Push.send({
                where: notifyApprovedQuery,
                data: {
                    alert: notifyApprovedAlertString,
                    badge: 1,
                    "key": "11",
                    //'content-available': 1,
                    refresh: "Installation"
                }
            }, { useMasterKey: true });
        }).then(function() {
            console.log("approvePendingTeamRequest: push sent");
            response.success();
        }, function(error) {
            console.log("approvePendingTeamRequest: Errors occurred " + error);
            response.error(error);
        });
    });

//=================================================
// This function is called when a Team owner
// has gone in to the Team Members list and changed an approved request
// to pending effectively taking them out of the team. It also notifies the
// Requester of the change in status.
//=================================================
// MARK: Function pendTeamRequest

Parse.Cloud.define("pendTeamRequest", function(request, response) {

    console.log("Function: pendTeamRequest: Start - value of requestId is " + request.params.requestId);

    var query = new Parse.Query("TeamRequests");
    query.equalTo(constants.objectIdName, request.params.requestId);

    query.first({ useMasterKey: true }).then(
        function(requestToPend) {
            // added first condition to protect against empty answer set e.g. bad client data
            if ((requestToPend) && (requestToPend.get("requestApproved") == true) && (request.user.id == requestToPend.get('teamOwnerId').id)) {
                console.log("Function: pendTeamRequest: request is approved and request id matches team owner id. Request owner is " + requestToPend.get('requestOwnerDisplayName'));
                // update the request status
                console.log("Function: pendTeamRequest: updating the request status");
                requestToPend.set("requestApproved", false);
                return requestToPend.save(null, {useMasterKey: true});
            } else {
                // force the promise to fail through to error handler
                console.log("Function: pendTeamRequest: ERROR either request is pending or request id does not matche team owner id.");
                return Parse.Promise.Error("Function: pendTeamRequest: ERROR TeamRequest is already pending or requestor is not the Team owner.");
            }
        }).then(function(requestToPend) {
            // send out notifications
            console.log("Function: pendTeamRequest: sending out notifications");
            var notifyApprovedQuery = new Parse.Query(Parse.Installation);
            var notifyApprovedAlertString = "Your membership in a ShareRides team has been changed to pending by the Team owner.";
            notifyApprovedQuery.equalTo("user", requestToPend.get("requestOwnerId"));

            return Parse.Push.send({
                where: notifyApprovedQuery,
                data: {
                    alert: notifyApprovedAlertString,
                    badge: 1,
                    "key": "12",
                    //'content-available': 1,
                    refresh: "Installation"
                }
            }, { useMasterKey: true });
        }).then(function() {
            console.log("pendTeamRequest: push sent");
            response.success();
        }, function(error) {
            console.log("pendTeamRequest: Errors occurred " + error);
            response.error(error);
        });
    });

//=================================================
// This function is called when requester wants to leave a team
//=================================================
// MARK: Function deleteTeamRequest

Parse.Cloud.define("deleteTeamRequest", function(request, response) {

    console.log("Function: deleteTeamRequest: Value of requestId " + request.params.requestId);
    var user;
    var team;
    var notifyUserMessage = "Your request to leave a Team completed successfully."
    var query = new Parse.Query("TeamRequests");
    query.equalTo(constants.objectIdName, request.params.requestId);
    query.first({ useMasterKey: true }).then(function(requestToDelete) {
        if ((!requestToDelete) || (request.user.id != requestToDelete.get('requestOwnerId').id)) {
            return Parse.Promise.error(999, "Team Request for delete was not found");
        }
        console.log("Function: deleteTeamRequest: The id in the function request matches the id of the request owner");
        user = requestToDelete.get('requestOwnerId');
        team = requestToDelete.get('teamId');
        owner = requestToDelete.get('teamOwnerId');
        return requestToDelete.destroy({ useMasterKey: true });
    }).then(function(success) {
        var query = new Parse.Query(Parse.Installation);
        query.equalTo(constants.userFieldName, user);
        query.each(function(installation) {
            installation.unset("team");
            console.log("Function: deleteTeamRequest: Removed the team attribute");
            installation.save(null, { useMasterKey: true });
        }, { useMasterKey: true });
        return Parse.Promise.as("Continue");
    }).then(function() {
        console.log("Function deleteTeamRequest: Installations updated");
        var notifyUserQuery = new Parse.Query(Parse.Installation);
        notifyUserQuery.equalTo("user", user);
        Parse.Push.send({
            where: notifyUserQuery,
            data: {
                    alert: notifyUserMessage,
                    badge: 1,
                    "key": "14",
                    'content-available': 1,
                    refresh: "Installation"
            }
        }, { useMasterKey: true });
        var notifyOwnerQuery = new Parse.Query(Parse.Installation);
        notifyOwnerQuery.equalTo("user", owner);
        Parse.Push.send({
            where: notifyOwnerQuery,
            data: {
                'content-available': 1,
                refresh: "Installation"
            }
        }, { useMasterKey: true });
        return response.success();
    },
    function(error) {      
        console.error(error);
        response.error(999, "An error occurred");
    });
});

//=================================================
// This function is called to check whether the user owns
// a Team for which there are outstanding requests to 
// Join.
//=================================================
// MARK: Function checkForPendingTeamRequests
Parse.Cloud.define("checkForPendingTeamRequests", function(request, response) {
    var hasOutstandingTeamRequests = false;
    var outstandingTeamRequestsArray = [];
    var teamQuery = new Parse.Query(constants.teamRequestsClassName);
    teamQuery.equalTo(constants.teamRequestsTeamOwnerIdName, request.user);
    teamQuery.each(function(teamRequest) {
        if (teamRequest.get(constants.teamRequestsRequestApprovedName) == false) {
            hasOutstandingTeamRequests = true;
            outstandingTeamRequestsArray.push(teamRequest);
        }
    }, {useMasterKey: true}).then(function() {
        response.success({
            'hasOutstandingTeamRequests': hasOutstandingTeamRequests, 
            'outstandingTeamRequestsArray': outstandingTeamRequestsArray
        });
    });
});

//=================================================
// This function is called to check whether the user owns
// a Ride for which there are outstanding requests to 
// Join.
//=================================================
// MARK: Function checkForPendingRideRequests
Parse.Cloud.define("checkForPendingRideRequests", function(request, response) {
    var hasOutstandingRideRequests = false;
    var outstandingRideRequestsArray = [];
    var requestsQuery = new Parse.Query(constants.requestsClassName);
    requestsQuery.equalTo(constants.requestsRideOwnerIdName, request.user);
    requestsQuery.each(function(request) {
        if (request.get(constants.requestsRequestApprovedName) == false) {
            hasOutstandingRideRequests = true;
            outstandingRideRequestsArray.push(request);
        }
    }, {useMasterKey: true}).then(function() {
        response.success({
            'hasOutstandingRideRequests': hasOutstandingRideRequests, 
            'outstandingRideRequestsArray': outstandingRideRequestsArray
        });
    });
});

//=================================================
// This function is called when a team owner wants to delete a team
// which deletes all requests and removes the Team from all members
// Installations
//=================================================
// MARK: Function deleteTeam
Parse.Cloud.define("deleteTeam", function(request, response) {

    var teamId = request.params.teamId;

    if (!teamId) {
        response.error(999, "Unable to retrieve Team for delete");
    }
    
    var teamQuery = new Parse.Query(constants.teamsClassName);
    teamQuery.equalTo(constants.objectIdName, teamId);

    var teamRequestsQuery = new Parse.Query(constants.teamRequestsClassName);

    var notifyTeamDeletedAlertString = "The ShareRides Team you belong to has been deleted by the owner. Please choose another Team in the app settings tab";

    teamQuery.first({ useMasterKey: true }).then(function(teamToDelete) {
        if ((!teamToDelete) || (request.user.id != teamToDelete.get('teamOwnerId').id)) {
            return Parse.Promise.error(999, "Unable to retrieve Team to delete or requester does not own the Team");
        }
        // enhance query with team we are deleting
        teamRequestsQuery.equalTo(constants.teamRequestsTeamIdName, teamToDelete);

        // flag the Team as deleted with current date
        teamToDelete.set("teamDeleted", true);
        teamToDelete.set("teamDeletedDate", new Date());
        teamToDelete.save(null, {useMasterKey: true});
        return teamRequestsQuery.find({ useMasterKey: true });
    // notify users that team has been deleted to refresh Installation 
    }).then(function(teamRequests) {
        for (var i = 0; i < teamRequests.length; ++i) {
            var installationQuery = new Parse.Query(Parse.Installation);
            var requestUser = teamRequests[i].get(constants.requestsOwnerIdName);
            installationQuery.equalTo(constants.userFieldName, requestUser);
            Parse.Push.send({
                where: installationQuery,
                data: {
                    alert: notifyTeamDeletedAlertString,
                    badge: 1,
                    "key": "13"
                }
            }, { useMasterKey: true });
        }
        return teamRequestsQuery.find({ useMasterKey: true });
    // remove the Team from the Installations 
    }).then(function(teamRequests) {
        for (var i = 0; i < teamRequests.length; ++i) {
            var installationQuery = new Parse.Query(Parse.Installation);
            var requestUser = teamRequests[i].get(constants.requestsOwnerIdName);
            installationQuery.equalTo(constants.userFieldName, requestUser);
            installationQuery.each(function(installation) {
                installation.unset("team");
                console.log("Function: deleteTeamRequest: Removed the team attribute");
                installation.save(null, { useMasterKey: true });
            }, { useMasterKey: true });
        }
        return teamRequestsQuery.find({ useMasterKey: true });
    }).then(function(teamRequests) {
        var noTeamInstallations = new Parse.Query(Parse.Installation);
        noTeamInstallations.equalTo('deviceType', 'ios');
        noTeamInstallations.equalTo(constants.channelKeyName, constants.channelSilentContent);
        noTeamInstallations.doesNotExist(constants.teamName);
        Parse.Push.send({
            where: noTeamInstallations,
            data: {
                'content-available': 1,
                refresh: "Installation"
            }
        }, { useMasterKey: true });
        for (var i = 0; i < teamRequests.length; ++i) {
            teamRequests[i].destroy({ useMasterKey: true });
        }
        response.success();
    },
    function(error) {
        response.error(error);
    });
});

Parse.Cloud.define("deleteTeamOLD", function(request, response) {
    // would normally validate the request parameters but it has to
    // match a requestId and it needs to pass the ownership tests
 
    var notifyTeamDeletedAlertString = "The ShareRides Team you belong to has been deleted by the owner. Please choose another Team in the app settings tab";
    var teamId = request.params.teamId;
    console.log("Function: deleteTeam: Value of teamId " + teamId);
    var query = new Parse.Query("Teams");
    query.equalTo(constants.objectIdName, teamId);
    query.first({ useMasterKey: true,
        success: function(teamToDelete) {
            // TODO: - Fix possible empty answer set condition when rewriting this
            console.log("Function: deleteTeam: retrieved Team");
            if (request.user.id == teamToDelete.get('teamOwnerId').id) {
                console.log("Function: deleteTeam: The id in the function request matches the id of the team owner");
                var teamOwner = teamToDelete.get('teamOwnerId');
 
                teamToDelete.set("teamDeleted", true);
                teamToDelete.set("teamDeletedDate", new Date());
                teamToDelete.save(null, {useMasterKey: true});
 
                teamRequestsQuery = new Parse.Query("TeamRequests");
                teamRequestsQuery.equalTo("teamId", teamToDelete);
                teamRequestsQuery.equalTo("teamOwnerId", teamOwner);

                teamRequestsQuery.find({ useMasterKey: true,
                    success: function(deleteRequests) {
                        for (var i = 0; i < deleteRequests.length; ++i) {
                            console.log("Function: deleteTeam: Deleting team request " + deleteRequests[i].id);
                            addRemoveUserTeam({ "team": teamToDelete, "user": deleteRequests[i].get("requestOwnerId"), "operation": "R" }, {
                                success: function(returnValue) {
                                    console.log("Function: deleteTeam: addRemoveUserTeam REMOVE success for " + deleteRequests[i].get("requestOwnerId").id);
                                },
                                error: function(error) {
                                    console.log("Function: deleteTeam: addRemoveUserTeam REMOVE failed for " + deleteRequests[i].get("requestOwnerId").id);
                                }
                            });
                            var notifyQuery = new Parse.Query(Parse.Installation);
                            notifyQuery.equalTo("user", deleteRequests[i].get("requestOwnerId"));

                            Parse.Push.send({
                                where: notifyQuery,
                                data: {
                                    alert: notifyTeamDeletedAlertString,
                                    badge: 1,
                                    "key": "13",
                                    //'content-available': 1,
                                    refresh: "Installation"
                                }
                            }, { useMasterKey: true }).then(function() {
                                console.log("Function: deleteTeam: notify push sent");
                            }, function(e) {
                                console.log("Function: deleteTeam: notify push failed " + error);
                            });

                            deleteRequests[i].destroy({ useMasterKey: true,
                                success: function() {
                                    console.log("Function: deleteTeam: delete of team request succeeded");
                                },
                                error: function() {
                                    console.log("Rides: After delete: Error in delete of team request");
                                    response.error("Unable to delete team request");
                                }
                            });
                        }
                    //response.success();
                    },
                    error: function (error) {
                        console.error("Error deleting related requests " + error.code + ": " + error.message);
                        response.error("Error deleting team requests");
                    }
                });
            }
        },
        error: function() {
            response.error("Function: deleteTeam: The server was unable to find the Team to delete it and related requests. Code: " + error.code);
        }
    });
});

//=================================================
// This function is called by when a Ride owner who has set their autoApproveRequests to no
// and has gone in to the Ride details and approved a pending request. It also notifies the
// Requester of the change in status.
//=================================================
// MARK: Function approve request

Parse.Cloud.define("approveRequest", function(request, response) {

    console.log("Function: approveRequest: Start - value of requestId is " + request.params.requestId);

    var query = new Parse.Query("Requests");
    query.equalTo(constants.objectIdName, request.params.requestId);

    query.first({ useMasterKey: true }).then(
        function(requestToApprove) {
            if ((requestToApprove) && (requestToApprove.get("requestApproved") == false) && (request.user.id == requestToApprove.get('rideOwnerId').id)) {
                console.log("Function: approveRequest: request is pending and requester id matches ride owner id. Request owner is " + requestToApprove.get('requestOwnerDisplayName'));
                // update the request status
                console.log("Function: approveRequest: updating the request status");
                requestToApprove.set("requestApproved", true);
                return requestToApprove.save(null, {useMasterKey: true});
            } else {
                // force the promise to fail through to error handler
                console.log("Function: approveRequest: ERROR either request is approved or request id does not match ride owner id.");
                return Parse.Promise.error("Function: approveRequest: ERROR Request is already approved or requestor is not the Ride owner.");
            }
        }).then(function(requestToApprove) {
            // send out notifications
            console.log("Function: approveRequest: sending out notifications");
            var notifyApprovedQuery = new Parse.Query(Parse.Installation);
            var notifyApprovedAlertString = "Your request to join a Ride has been approved.";
            notifyApprovedQuery.equalTo("user", requestToApprove.get("requestOwnerId"));

            return Parse.Push.send({
                where: notifyApprovedQuery,
                data: {
                    alert: notifyApprovedAlertString,
                    badge: 1,
                    "key": "4",
                    //'content-available': 1,
                    refresh: "Installation"
                }
            }, { useMasterKey: true });
        }).then(function() {
            console.log("Function: approveRequest: push sent");
            response.success();
        }, function(error) {
            console.log("Function: approveRequest: Errors occurred " + error);
            response.error(error);
        });
    });

//=================================================
// This function is called by a Ride owner who 
// has gone in to the Ride details and is reversing a previously approved Request
// The function also notifies the Requester of the
// change in status.
//=================================================
// MARK: function pend request

Parse.Cloud.define("pendRequest", function(request, response) {

    console.log("Function: pendRequest: Start - value of requestId is " + request.params.requestId);

    var query = new Parse.Query("Requests");
    query.equalTo(constants.objectIdName, request.params.requestId);

    query.first({ useMasterKey: true }).then(
        function(requestToPend) {
            if ((requestToPend) && (requestToPend.get("requestApproved") == true) && (request.user.id == requestToPend.get('rideOwnerId').id)) {
                console.log("Function: pendRequest: request is approved and requester id matches ride owner id. Request owner is " + requestToPend.get('requestOwnerDisplayName'));
                // update the request status
                console.log("Function: pendRequest: updating the request status");
                requestToPend.set("requestApproved", false);
                return requestToPend.save(null, {useMasterKey: true});
            } else {
                // force the promise to fail through to error handler
                console.log("Function: pendRequest: ERROR either request is pending or requester id does not match ride owner id.");
                return Parse.Promise.Error("Function: pendRequest: ERROR Request is already pending or requestor is not the Ride owner.");
            }
        }).then(function(requestToPend) {
            // send out notifications
            console.log("Function: pendRequest: sending out notifications");
            var notifyApprovedQuery = new Parse.Query(Parse.Installation);
            var notifyApprovedAlertString = "Your ShareRides request has been changed to pending. It needs approval from the Ride owner.";
            notifyApprovedQuery.equalTo("user", requestToPend.get("requestOwnerId"));

            return Parse.Push.send({
                where: notifyApprovedQuery,
                data: {
                    alert: notifyApprovedAlertString,
                    badge: 1,
                    "key": "5",
                    //'content-available': 1,
                    refresh: "Installation"
                }
            }, { useMasterKey: true });
        }).then(function() {
            console.log("Function: pendRequest: push sent");
            response.success();
        }, function(error) {
            console.log("Function: pendRequest: Errors occurred " + error);
            response.error(error);
        });
    });

//=================================================
// This function is called to determine whether the system is in normal online operation.
// If it isn't it will contain other status flags
//=================================================
// MARK: Function system status

Parse.Cloud.define("systemStatus", function(request, response) {
    //var messageToSend = "system status function invoked by " + request.user.id; 
    //sendToAdminChannel(messageToSend); 
    var query = new Parse.Query(constants.systemStatusClassName);
    query.first({ useMasterKey: true,
        success: function(systemStatusEntry) {
            if (systemStatusEntry) {
                response.success({
                    'onlineStatus'      : systemStatusEntry.get('online'),
                    'nextCheck'         : systemStatusEntry.get('nextServerStatusCheckSeconds'),
                    'eta'               : systemStatusEntry.get('expectedAvailability'),
                    'outageReason'      : systemStatusEntry.get('outageReason'),
                    'minClientVersion'  : systemStatusEntry.get('minClientVersion'),
                    'minClientBuild'    : systemStatusEntry.get('minClientBuild')
                });
            } else {
                response.success({
                    'onlineStatus'      : true,
                    'nextCheck'         : 14400,
                    'eta'               : '2016-01-01T12:00:00.000Z',
                    'outageReason'      : 'The system status record is missing or invalid.',
                    'minClientVersion'  : '0',
                    'minClientBuild'    : '0'
                });                
            }
        },
        error: function() {
            response.error("Function: SystemStatus: The server could not retrieve the system status record. Code: " + error.code);
        }
    });
});

//=================================================
// This function adds or removes a team name on all Installations for the provided user pointer
// function expects three parameters - the team to be added to the user's installation,
// the user object and the operation code
//=================================================
// MARK: - Function addRemoveUserTeam
                       
function addRemoveUserTeam(params) {
    var team = params.team;
    var user = params.user;
    var operation = params.operation;
    console.log("Function: addRemoveUserTeam: teamId is " + team.id + " and userId is " + user.id + " and operation is " + operation);
    //return Parse.Promise.as();
    // validate parameters
    if ((!team) || (!user) || (!operation) || ((operation != "A") && (operation!= "R"))) {
        return Parse.Promise.Error("Function: addRemoveUserTeam: bad parameters to function call");        
    }
    // A user might have more than one Installation
    var query = new Parse.Query(Parse.Installation);
    query.equalTo("user", user); // Match Installations with a pointer to this User
    return query.each(function(installation) {
        console.log("Function: AddRemoveUserTeam: Updating Installation ");
        if (operation == "A") {
            installation.set("team", team);
            console.log("Function: AddRemoveUserTeam: Set the team attribute");
        }
        if (operation == "R") {
            installation.unset("team");
            console.log("Function: AddRemoveUserTeam: Removed the team attribute");
        }
        return installation.save(null, {useMasterKey: true});
    }, { useMasterKey: true }).then(function() {
        // the installations was saved.
        console.log("Function AddRemoveUserTeam: Installations saved");
        var notifyQuery = new Parse.Query(Parse.Installation);
        notifyQuery.equalTo("user", user);

        return Parse.Push.send({
            where: notifyQuery,
            data: {
                'content-available': 1,
                refresh: "Installation"
            }
        }, { useMasterKey: true });
    },
    function(error) {      
        console.error(error);
        return Parse.Promise.error("An error occurred while looking up this user's installations.")
    });
};

//=================================================
// This function is called to tell the admin channel that something has happened
//=================================================
// MARK: Function sendToAdminChannel

function sendToAdminChannel(messageToSend) {

    if (constants.informAdminFlag) {
        var notifyQuery = new Parse.Query(Parse.Installation);
        notifyQuery.equalTo(constants.channelKeyName, constants.channelAdminName);
        Parse.Push.send({
            where: notifyQuery,
            data: {
                alert: messageToSend,
                badge: 1,
                "key": "99"
            }
        }, { useMasterKey: true });
    } 
    return;
};

//=================================================
// This function is called to determine whether the system is in normal online operation.
// If it isn't it will contain other status flags
//=================================================
// MARK: Function Team has outstanding requests

Parse.Cloud.define("teamHasRequests", function(request, response) {
    var team = request.params.team;
    var query = new Parse.Query(constants.systemStatusClassName);
    query.first({ useMasterKey: true }).then(function(systemStatusEntry) {
        if (systemStatusEntry) {
            response.success({
                'hasRequests' : true
            });
        } else {
            response.success({
                'hasRequests' : false
            });
        }
    },
    function(error) {
        response.error("Function: SystemStatus: The server could not retrieve the system status record. Code: " + error.code);
    });
});

//=================================================
// This function adds a channel name to all Installations for the provided user pointer
// function expects two parameters - the channel to be added to the user's installation
// and the user's object ID
//=================================================
// MARK: Function subscribe to channel

Parse.Cloud.define("subscribeToChannel", function(request, response) {
    var channelName = request.params.channel;
    var userId = request.params.userId;
                   
    if (!channelName) {
        response.error({errorCode: 9001, errorMessage: "Missing parameter: channel"});
        return;
        }
                   
    if (!userId) {
        response.error(9002, "Missing parameter: userId")
        return;
        }
                   
    if (userId != request.user.id) {
        response.error("Requesters id and userid in the request do not match");
    }
                   
    // Create a Pointer to this user based on their object id
    var user = new Parse.User();
    user.id = userId;
                   
    // A user might have more than one Installation
    var query = new Parse.Query(Parse.Installation);
    query.equalTo("user", user); // Match Installations with a pointer to this User
    query.find({useMasterKey: true,
        success: function(installations) {
            for (var i = 0; i < installations.length; ++i) {
                // Add the channel to all the installations for this user
                installations[i].addUnique("channels", channelName);
                }
                              
            // Save all the installations
            Parse.Object.saveAll(installations, {useMasterKey: true,
                success: function(installations) {
                    // All the installations were saved.
                    response.success("All the installations were updated with this channel.");
                    },
                error: function(error) {
                    // An error occurred while saving one of the objects.
                    console.error(error);
                    response.error("An error occurred while updating this user's installations.")
                    },
                });
            },
        error: function(error) {
            console.error(error);
            response.error("An error occurred while looking up this user's installations.")
            }
        });
    });

//=================================================
// Date comparison functions
// Source: http://stackoverflow.com/questions/497790
//=================================================

var dates = {
convert:function(d) {
    // Converts the date in d to a date-object. The input can be:
    //   a date object: returned without modification
    //  an array      : Interpreted as [year,month,day]. NOTE: month is 0-11.
    //   a number     : Interpreted as number of milliseconds
    //                  since 1 Jan 1970 (a timestamp)
    //   a string     : Any format supported by the javascript engine, like
    //                  "YYYY/MM/DD", "MM/DD/YYYY", "Jan 31 2009" etc.
    //  an object     : Interpreted as an object with year, month and date
    //                  attributes.  **NOTE** month is 0-11.
    return (
            d.constructor === Date ? d :
            d.constructor === Array ? new Date(d[0],d[1],d[2]) :
            d.constructor === Number ? new Date(d) :
            d.constructor === String ? new Date(d) :
            typeof d === "object" ? new Date(d.year,d.month,d.date) :
            NaN
            );
},
compare:function(a,b) {
    // Compare two dates (could be of any type supported by the convert
    // function above) and returns:
    //  -1 : if a < b
    //   0 : if a = b
    //   1 : if a > b
    // NaN : if a or b is an illegal date
    // NOTE: The code inside isFinite does an assignment (=).
    return (
            isFinite(a=this.convert(a).valueOf()) &&
            isFinite(b=this.convert(b).valueOf()) ?
            (a>b)-(a<b) :
            NaN
            );
},
inRange:function(d,start,end) {
    // Checks if date in d is between dates in start and end.
    // Returns a boolean or NaN:
    //    true  : if d is between start and end (inclusive)
    //    false : if d is before start or after end
    //    NaN   : if one or more of the dates is illegal.
    // NOTE: The code inside isFinite does an assignment (=).
    return (
            isFinite(d=this.convert(d).valueOf()) &&
            isFinite(start=this.convert(start).valueOf()) &&
            isFinite(end=this.convert(end).valueOf()) ?
            start <= d && d <= end :
            NaN
            );
}
}

/*
 * Date Format 1.2.3
 * (c) 2007-2009 Steven Levithan <stevenlevithan.com>
 * MIT license
 *
 * Includes enhancements by Scott Trenda <scott.trenda.net>
 * and Kris Kowal <cixar.com/~kris.kowal/>
 *
 * Accepts a date, a mask, or a date and a mask.
 * Returns a formatted version of the given date.
 * The date defaults to the current date/time.
 * The mask defaults to dateFormat.masks.default.
 */

var dateFormat = function () {
    var	token = /d{1,4}|m{1,4}|yy(?:yy)?|([HhMsTt])\1?|[LloSZ]|"[^"]*"|'[^']*'/g,
    timezone = /\b(?:[PMCEA][SDP]T|(?:Pacific|Mountain|Central|Eastern|Atlantic) (?:Standard|Daylight|Prevailing) Time|(?:GMT|UTC)(?:[-+]\d{4})?)\b/g,
    timezoneClip = /[^-+\dA-Z]/g,
    pad = function (val, len) {
        val = String(val);
        len = len || 2;
        while (val.length < len) val = "0" + val;
        return val;
    };
    
    // Regexes and supporting functions are cached through closure
    return function (date, mask, utc) {
        var dF = dateFormat;
        
        // You can't provide utc if you skip other args (use the "UTC:" mask prefix)
        if (arguments.length == 1 && Object.prototype.toString.call(date) == "[object String]" && !/\d/.test(date)) {
            mask = date;
            date = undefined;
        }
        
        // Passing date through Date applies Date.parse, if necessary
        date = date ? new Date(date) : new Date;
        if (isNaN(date)) throw SyntaxError("invalid date");
        
        mask = String(dF.masks[mask] || mask || dF.masks["default"]);
        
        // Allow setting the utc argument via the mask
        if (mask.slice(0, 4) == "UTC:") {
            mask = mask.slice(4);
            utc = true;
        }
        
        var	_ = utc ? "getUTC" : "get",
        d = date[_ + "Date"](),
        D = date[_ + "Day"](),
        m = date[_ + "Month"](),
        y = date[_ + "FullYear"](),
        H = date[_ + "Hours"](),
        M = date[_ + "Minutes"](),
        s = date[_ + "Seconds"](),
        L = date[_ + "Milliseconds"](),
        o = utc ? 0 : date.getTimezoneOffset(),
        flags = {
        d:    d,
        dd:   pad(d),
        ddd:  dF.i18n.dayNames[D],
        dddd: dF.i18n.dayNames[D + 7],
        m:    m + 1,
        mm:   pad(m + 1),
        mmm:  dF.i18n.monthNames[m],
        mmmm: dF.i18n.monthNames[m + 12],
        yy:   String(y).slice(2),
        yyyy: y,
        h:    H % 12 || 12,
        hh:   pad(H % 12 || 12),
        H:    H,
        HH:   pad(H),
        M:    M,
        MM:   pad(M),
        s:    s,
        ss:   pad(s),
        l:    pad(L, 3),
        L:    pad(L > 99 ? Math.round(L / 10) : L),
        t:    H < 12 ? "a"  : "p",
        tt:   H < 12 ? "am" : "pm",
        T:    H < 12 ? "A"  : "P",
        TT:   H < 12 ? "AM" : "PM",
        Z:    utc ? "UTC" : (String(date).match(timezone) || [""]).pop().replace(timezoneClip, ""),
        o:    (o > 0 ? "-" : "+") + pad(Math.floor(Math.abs(o) / 60) * 100 + Math.abs(o) % 60, 4),
        S:    ["th", "st", "nd", "rd"][d % 10 > 3 ? 0 : (d % 100 - d % 10 != 10) * d % 10]
        };
        
        return mask.replace(token, function ($0) {
                            return $0 in flags ? flags[$0] : $0.slice(1, $0.length - 1);
                            });
    };
}();

// Some common format strings
dateFormat.masks = {
    "default":      "ddd mmm dd yyyy HH:MM:ss",
shortDate:      "m/d/yy",
mediumDate:     "mmm d, yyyy",
longDate:       "mmmm d, yyyy",
fullDate:       "dddd, mmmm d, yyyy",
shortTime:      "h:MM TT",
mediumTime:     "h:MM:ss TT",
longTime:       "h:MM:ss TT Z",
isoDate:        "yyyy-mm-dd",
isoTime:        "HH:MM:ss",
isoDateTime:    "yyyy-mm-dd'T'HH:MM:ss",
isoUtcDateTime: "UTC:yyyy-mm-dd'T'HH:MM:ss'Z'"
};

// Internationalization strings
dateFormat.i18n = {
dayNames: [
           "Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat",
           "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"
           ],
monthNames: [
             "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
             "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"
             ]
};

// For convenience...
Date.prototype.format = function (mask, utc) {
    return dateFormat(this, mask, utc);
};


