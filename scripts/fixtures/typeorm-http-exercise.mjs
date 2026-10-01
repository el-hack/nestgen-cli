import 'reflect-metadata';
import assert from 'node:assert/strict';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from './build/app.module.js';

let step = 'initialisation de NestJS';
const app = await NestFactory.create(AppModule, { logger: false });
app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
// Keep one loopback listener for the complete scenario instead of reopening an ephemeral server per request.
await app.listen(0, '127.0.0.1');
try {
    const api = request(app.getHttpServer());
    step = 'document OpenAPI';
    const document = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('E2E').build());
    const productPath = document.paths['/catalog/products'];
    const schema = document.components?.schemas?.CreateProductDto;
    assert.ok(productPath?.post && productPath.get);
    assert.equal(
        productPath.get.parameters?.some((parameter) => parameter.name === 'page'),
        true,
    );
    assert.equal(
        productPath.get.parameters?.some((parameter) => parameter.name === 'limit'),
        true,
    );
    assert.equal(schema?.required?.includes('sku'), true);
    assert.equal(schema?.properties?.releasedAt.format, 'date-time');
    assert.equal(schema?.properties?.reference.format, 'uuid');
    assert.equal(schema?.properties?.releasedAt.nullable, true);
    assert.equal(productPath.post.responses['201']?.description, 'Product créé.');
    assert.equal(productPath.post.responses['409']?.description, 'Valeur unique déjà utilisée.');
    step = 'validation des identifiants pour les deux profils';
    for (const route of ['/catalog/products', '/simple-products']) {
        for (const method of ['get', 'patch', 'delete']) {
            await api[method](route + '/not-a-uuid').expect(400);
            await api[method](route + '/00000000-0000-4000-8000-000000000001').expect(404);
        }
        const sample = await api
            .post(route)
            .send({ sku: 'uuid-check', price: 1, amount: '1.00', status: 'DRAFT', published: false })
            .expect(201);
        await api.get(route + '/' + sample.body.id).expect(200);
        await api
            .patch(route + '/' + sample.body.id)
            .send({ price: 2 })
            .expect(200);
        await api.delete(route + '/' + sample.body.id).expect(204);

        step = 'champs absents, nullables et valeurs falsy : ' + route;
        const required = { sku: 'partial-check', price: 12, amount: '12.34', status: 'DRAFT', published: true };
        for (const field of Object.keys(required)) {
            await api
                .post(route)
                .send({ ...required, [field]: null })
                .expect(400);
            const missing = { ...required };
            delete missing[field];
            await api.post(route).send(missing).expect(400);
        }
        const optional = {
            releasedAt: '2026-09-30T12:00:00.000Z',
            note: 'retained',
            quantity: 3,
            enabled: true,
            reference: '00000000-0000-4000-8000-000000000002',
        };
        const original = await api
            .post(route)
            .send({ ...required, ...optional })
            .expect(201);
        assert.equal(original.body.stock, 0);
        assert.equal(original.body.category, 'general');
        const resourceUrl = route + '/' + original.body.id;
        for (const field of Object.keys(required)) {
            await api
                .patch(resourceUrl)
                .send({ [field]: null })
                .expect(400);
        }
        for (const field of ['releasedAt', 'quantity', 'enabled', 'reference']) {
            await api
                .patch(resourceUrl)
                .send({ [field]: '' })
                .expect(400);
        }
        const falsy = { sku: '', price: 0, published: false, note: '', quantity: 0, enabled: false };
        await api.patch(resourceUrl).send(falsy).expect(200);
        const persisted = await api.get(resourceUrl).expect(200);
        assert.deepEqual(persisted.body, { ...original.body, ...falsy });
        await api.patch(resourceUrl).send({}).expect(200);
        const unchanged = await api.get(resourceUrl).expect(200);
        assert.deepEqual(unchanged.body, persisted.body);

        const nulls = Object.fromEntries(Object.keys(optional).map((field) => [field, null]));
        const defaults = { stock: 0, category: 'general' };
        await api.patch(resourceUrl).send(nulls).expect(200);
        const cleared = await api.get(resourceUrl).expect(200);
        assert.deepEqual(cleared.body, { ...persisted.body, ...nulls });
        await api.patch(resourceUrl).send(optional).expect(200);
        const restored = await api.get(resourceUrl).expect(200);
        assert.deepEqual(restored.body, { ...persisted.body, ...optional });
        await api.delete(resourceUrl).expect(204);

        const withNulls = await api
            .post(route)
            .send({ ...required, ...nulls })
            .expect(201);
        const nullRead = await api.get(route + '/' + withNulls.body.id).expect(200);
        assert.deepEqual(nullRead.body, { id: withNulls.body.id, ...required, ...defaults, ...nulls });
        await api.delete(route + '/' + withNulls.body.id).expect(204);
        const omitted = await api.post(route).send(required).expect(201);
        const omittedRead = await api.get(route + '/' + omitted.body.id).expect(200);
        assert.deepEqual(omittedRead.body, { id: omitted.body.id, ...required, ...defaults, ...nulls });
        await api.delete(route + '/' + omitted.body.id).expect(204);

        await api
            .post(route)
            .send({ ...required, amount: 'not-a-decimal' })
            .expect(400);
        await api
            .post(route)
            .send({ ...required, status: 'UNKNOWN' })
            .expect(400);
        await api
            .post(route)
            .send({ ...required, quantity: 1.5 })
            .expect(400);
        await api
            .post(route)
            .send({ ...required, stock: -1 })
            .expect(400);
        await api
            .post(route)
            .send({ ...required, category: 'x'.repeat(33) })
            .expect(400);
    }
    step = 'relation un-à-plusieurs';
    const customer = await api.post('/customers').send({ email: 'customer@example.test' }).expect(201);
    await api
        .post('/orders')
        .send({ reference: 'missing-customer', customerId: '00000000-0000-4000-8000-000000000099' })
        .expect(409);
    const order = await api.post('/orders').send({ reference: 'order-1', customerId: customer.body.id }).expect(201);
    assert.equal(order.body.customerId, customer.body.id);
    await api.delete('/customers/' + customer.body.id).expect(409);
    await api.delete('/orders/' + order.body.id).expect(204);
    await api.delete('/customers/' + customer.body.id).expect(204);
    step = 'relation plusieurs-à-plusieurs';
    const role = await api.post('/roles').send({ name: 'admin' }).expect(201);
    const user = await api.post('/users').send({ email: 'user@example.test' }).expect(201);
    await api.post(`/users/${user.body.id}/roles/${role.body.id}`).expect(204);
    const database = app.get(DataSource);
    const associations = await database.query('SELECT "userId", "roleId" FROM join_users_roles_roles');
    assert.deepEqual(associations, [{ userId: user.body.id, roleId: role.body.id }]);
    await api.delete(`/users/${user.body.id}/roles/${role.body.id}`).expect(204);
    assert.deepEqual(await database.query('SELECT "userId", "roleId" FROM join_users_roles_roles'), []);
    await api.get(`/roles/${role.body.id}`).expect(200);
    const membership = await api
        .post('/memberships')
        .send({ userId: user.body.id, roleId: role.body.id, scope: 'admin' })
        .expect(201);
    await api.post('/memberships').send({ userId: user.body.id, roleId: role.body.id, scope: 'editor' }).expect(409);
    await api.delete(`/memberships/${membership.body.id}`).expect(204);
    await api.delete(`/users/${user.body.id}`).expect(204);
    await api.delete(`/roles/${role.body.id}`).expect(204);
    step = 'création de la ressource';
    const created = await api
        .post('/catalog/products')
        .send({ sku: 'sku-1', price: 12.5, amount: '1234567890.12', status: 'DRAFT', published: true })
        .expect(201);
    if (
        !created.body.id ||
        created.body.price !== 12.5 ||
        created.body.amount !== '1234567890.12' ||
        created.body.status !== 'DRAFT'
    )
        throw new Error('La création TypeORM ne retourne pas la ressource persistée.');
    step = 'validation HTTP 400';
    await api
        .post('/catalog/products')
        .send({ sku: 'sku-2', price: 'invalid', amount: '12.34', status: 'DRAFT', published: true })
        .expect(400);
    step = 'conflit HTTP 409';
    await api
        .post('/catalog/products')
        .send({ sku: 'sku-1', price: 15, amount: '12.34', status: 'ACTIVE', published: false })
        .expect(409);
    step = 'borne de pagination';
    await api.get('/catalog/products?limit=101').expect(400);
    step = 'lecture paginée';
    const listed = await api.get('/catalog/products?page=1&limit=1').expect(200);
    if (listed.body.data.length !== 1 || listed.body.limit !== 1)
        throw new Error('La pagination ne renvoie pas le contrat attendu.');
    await api
        .post('/simple-products')
        .send({ sku: 'filter-check', price: 12, amount: '1.00', status: 'DRAFT', published: false })
        .expect(201);
    const filtered = await api.get('/simple-products?skuContains=filter&priceGte=10&sort=price:desc').expect(200);
    assert.equal(filtered.body.data[0].sku, 'filter-check');
    await api.get('/simple-products?unknown=value').expect(400);
    await api.get('/simple-products?sort=price:sideways').expect(400);
    await api.get('/simple-products?sort=price:desc:extra').expect(400);
    await api
        .post('/simple-products')
        .send({ sku: 'cursor-one', price: 21, amount: '1.00', status: 'DRAFT', published: false })
        .expect(201);
    await api
        .post('/simple-products')
        .send({ sku: 'cursor-two', price: 22, amount: '1.00', status: 'DRAFT', published: false })
        .expect(201);
    const firstCursorPage = await api.get('/simple-products?skuContains=cursor&limit=1').expect(200);
    assert.equal(firstCursorPage.body.data.length, 1);
    assert.equal(typeof firstCursorPage.body.nextCursor, 'string');
    const secondCursorPage = await api
        .get(`/simple-products?skuContains=cursor&limit=1&after=${encodeURIComponent(firstCursorPage.body.nextCursor)}`)
        .expect(200);
    assert.equal(secondCursorPage.body.data.length, 1);
    assert.notEqual(secondCursorPage.body.data[0].id, firstCursorPage.body.data[0].id);
    await api.get('/simple-products?after=invalid-cursor').expect(400);
    await api
        .get(`/simple-products?after=${encodeURIComponent(firstCursorPage.body.nextCursor)}&sort=price:desc`)
        .expect(400);
    step = 'mise à jour';
    await api
        .patch('/catalog/products/' + created.body.id)
        .send({ price: 20, amount: '9876543210.98', status: 'ACTIVE' })
        .expect(200);
    step = 'lecture après mise à jour';
    const found = await api.get('/catalog/products/' + created.body.id).expect(200);
    if (found.body.price !== 20 || found.body.amount !== '9876543210.98' || found.body.status !== 'ACTIVE')
        throw new Error('La mise à jour TypeORM n’est pas persistée sans perte de précision.');
    step = 'suppression';
    await api.delete('/catalog/products/' + created.body.id).expect(204);
    step = 'vérification HTTP 404';
    await api.get('/catalog/products/' + created.body.id).expect(404);
} catch (error) {
    console.error('TypeORM HTTP integration failed during ' + step + ':', error);
    throw error;
} finally {
    await app.close();
}
