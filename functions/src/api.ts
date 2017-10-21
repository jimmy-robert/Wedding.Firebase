import * as bodyParser from 'body-parser';
import * as express from 'express';
import * as admin from 'firebase-admin';
import * as _ from 'lodash';
import * as map from 'p-map';

import { usingGuests } from './algolia';

// == API ==

export const app = express();

app.use(bodyParser.json());

app.get('/', wrapHandler(root));

app.get('/guest/search/:query', wrapHandler(searchGuest));

app.post('/guest/request', wrapHandler(requestGuest));

app.get('/group/:id', wrapHandler(getGroupById));

app.post('/group/:id/request', wrapHandler(requestGuestForGroup));

app.post('/group/:id/respond', wrapHandler(respondToGroup));

// == Functions ==

/**
 * Root route pribts node version and app version.
 * @param request
 * @param response
 */
function root(request, response) {
    response.send({
        node: process.version,
        version: require('./../package.json').version
    });
}

/**
 * Searches guest using Algoliasearch.
 * @param request
 * @param response
 * @returns {Promise<void>}
 */
async function searchGuest(request, response) {
    const query = request.params.query;
    const result = await usingGuests(async index => {
        return await index.search({query});
    });
    const guests = _.map(result.hits, (hit: any) => {
        return {
            id: hit.objectID,
            firstName: hit.firstName,
            lastName: hit.lastName,
            groupId: hit.groupId,
        };
    });
    response.send(guests);
}

/**
 * Requests a new guest with no group.
 * @param request
 * @param response
 */
async function requestGuest(request, response) {
    const {firstName, lastName, phoneNumber} = request.body;
    if (!firstName || !lastName || !phoneNumber) throw new Error('First name, last name and phone number are mandatory.');
    const ref = await admin.firestore().collection('Requests').add({
        firstName,
        lastName,
        phoneNumber
    });
    response.status(200).send({
        id: ref.id
    });
}

/**
 * Gets group by id.
 * @param request
 * @param response
 * @returns {Promise<void>}
 */
async function getGroupById(request, response) {
    const id = request.params.id;
    const snapshot = await admin.firestore().collection('Groups').doc(id).get();
    const group = await deep(snapshot);
    response.send(group);
}

/**
 * Requests a new guest to the group.
 * @param request
 * @param response
 */
async function requestGuestForGroup(request, response) {
    // TODO Check that user is authenticated and that phone number is defined in group
    const id = request.params.id;
    const {firstName, lastName, phoneNumber} = request.body;
    if (!firstName || !lastName) throw new Error('First name and last name are mandatory. Phone number is optional.');
    const ref = await admin.firestore().collection('Requests').add({
        groupId: id,
        firstName, lastName, phoneNumber
    });
    response.status(200).send({
        id: ref.id
    });
}

/**
 * Updates all responses for guests in a group.
 * @param request
 * @param response
 * @returns {Promise<void>}
 */
async function respondToGroup(request, response) {
    // TODO Check that user is authenticated and that phone number is defined in group
    const id = request.params.id;
    const responses = request.body;
    const firestore = admin.firestore();
    const guests = await firestore.collection('Groups').doc(id).collection('Guests');
    const batch = firestore.batch();
    _.each(responses, (guestResponse, guestId) => {
        batch.update(guests.doc(guestId), {response: guestResponse})
    });
    await batch.commit();
    response.send({
        success: true
    });
}

/**
 * Wraps the handler to ensure evertyhing runs as expected, and if not respond with a 500 error.
 * @param handler
 * @returns {(request, response) => Promise<any>}
 */
function wrapHandler(handler) {
    return async (request, response) => {
        try {
            await handler(request, response);
            if (!response.headersSent) {
                response.status(500).send({
                    error: 'Request has not been handled correctly.'
                });
            }
        } catch (error) {
            response.status(500).send({
                error: error.toString()
            });
        }
    };
}

/**
 * Deeply get Firestore document (i.e. get a document and all documents in all subcollections)
 * @param documentSnapshot
 * @returns {Promise}
 */
async function deep(documentSnapshot) {
    const document = documentSnapshot.data();
    const subcollections = await documentSnapshot.ref.getCollections();
    await map(subcollections, async subcollection => {
        const querySnapshot = await subcollection.get();
        document[subcollection.id] = await map(querySnapshot.docs, async documentSnapshot => {
            return await deep(documentSnapshot);
        });
    });
    return document;
}
