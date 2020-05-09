'use strict';
const crypto = require('crypto');
const pug = require('pug');
const Cookies = require('cookies');
const util = require('./handler-util');
const Post = require('./post');
const moment = require('moment-timezone');

const trackingIdKey = 'tracking_id';

const oneTimeTokenMap = new Map(); //キー: ユーザー名,  値: トークン

function handle (req, res) {
    const cookies = new Cookies(req, res);
    const trackingId = addTrackingCookies(cookies, req.user);
    
    switch (req.method) {
        case 'GET':
            res.writeHead(200, {
                'Content-Type': 'text/html; charset=utf-8'
            });
            Post.findAll({order:[['id', 'DESC']]}).then((posts) => {
                posts.forEach((post) => {
                    post.formattedCreatedAt = moment(post.createdAt).tz('Asia/Tokyo').format('YYYY年MM月DD日 HH時mm分ss秒');
                    post.content = post.content.replace(/\+/g, ' ');
                });
                const oneTimeToken = crypto.randomBytes(8).toString('hex');
                oneTimeTokenMap.set(req.user, oneTimeToken);
                res.end(pug.renderFile('./views/posts.pug', {
                    posts,
                    user: req.user,
                    oneTimeToken: oneTimeToken
                }));
            console.info(
                `閲覧されました: user: ${req.user},  trackingId: ${trackingId},  remoteAddress: ${req.connection.remoteAddress},  userAgent: ${req.headers['user-agent']}`
            );
            });
            break;
        case 'POST':
            let body = [];
            req.on('data', (chunk) => {
                body.push(chunk);
            }).on('end', () => {
                body = Buffer.concat(body).toString();
                const decoded = decodeURIComponent(body);
                const dataArray = decoded.split('&');
                const content = dataArray[0] ? dataArray[0].split('content=')[1] : '';
                const requestedOneTimeToken = dataArray[1] ? dataArray[1].split('oneTimeToken=')[1] : '';
                if (oneTimeTokenMap.get(req.user) === requestedOneTimeToken) {
                    console.info(`投稿されました: ${content}`);
                    Post.create({
                        content: content,
                        trackingCookie: trackingId,
                        postedBy: req.user
                    }).then(() => {
                        oneTimeTokenMap.delete(req.user);
                        handleRedirectPosts(req, res);
                    });
                } else {
                    util.handleBadRequest(req, res);
                }

            });
            break;
        default:
            util.handleBadRequest(req, res);
            break;
    }
}

function handleDelete(req, res) {
    switch (req.method) {
        case 'POST':
            let body = [];
            req.on('data', (chunk) => {
                body.push(chunk);
            }).on('end', () => {
                body = Buffer.concat(body).toString();
                const decoded = decodeURIComponent(body);
                const dataArray = decoded.split('&');
                const id = dataArray[0] ? dataArray[0].split('id=')[1] : '';
                const requestedOneTimeToken = dataArray[1] ? dataArray[1].split('oneTimeToken=')[1] : '';
                if (oneTimeTokenMap.get(req.user) === requestedOneTimeToken) {
                    Post.findById(id).then((post) => {
                        if (req.user === post.postedBy || req.user === 'admin') {
                            post.destroy().then(() => {
                                console.info(
                                    `削除されました: user: ${req.user}, ` +
                                    `remoteAddress: ${req.connection.remoteAddress}, ` +
                                    `userAgent: ${req.headers['user-agent']} `
                                );
                                oneTimeTokenMap.delete(req.user);
                                handleRedirectPosts(req, res);
                            });
                        }
                    });
                } else {
                    util.handleBadRequest(req, res);
                }
            });
            break;
        default:
            util.handleBadRequest(req, res);
            break;
    }
}    

/**
 * 
 * @param {Cookies} cookies 
 * @param {String} userName
 * @return {String} トラッキングID 
 */
function addTrackingCookies(cookies, userName) {
    const requestedTrackingId = cookies.get(trackingIdKey);
    if (isValidTrackingId(requestedTrackingId, userName)) {
        return requestedTrackingId;
    } else {
        const originalId = parseInt(crypto.randomBytes(8).toString('hex'), 16);
        const tomorrow = new Date(Date.now() + (1000 * 60 * 60 * 24));
        const trackingId = `${originalId}_${createValidHash(originalId, userName)}`;
        cookies.set(trackingIdKey, trackingId, {expires : tomorrow});
        return trackingId;
    }
}

function isValidTrackingId(trackingId, userName) {
    if(!trackingId) {
        return false;
    }
    const splitted = trackingId.split('_');
    const originalId = splitted[0];
    const requestedHash = splitted[1];
    return createValidHash(originalId, userName) === requestedHash;
}

const secretKey =
    `aecf51202625a792da1fd894030d0133233c7043655bbba5565d9195b0f6d427f236d5851a80d72c
    a3cf1be5aa77c24abff568149b4f58bdbac015cbd91093d19bc51cbfa2e614f065fd641c905ccd370
    5bf2ebe8f9642a08995ffeeafcddb5cc003776a788aedd5b748754678331ba0dbc23978005e24ed1a
    920e5d30487625e6aae096961ce1e7192bd38d4eea1d8014e3724be9ad118cf06351369b2c67794d9
    04276de8b86d395ce2c387b6d3d0c14d34bc2ef223e45710f441072dccab90dbfe027662191febf6b
    5e38f533fa16049951cf8fb5f1908b27457e7aa8039e6202140ce9694caa26fbb4d3b83763b25b7ec
    c9fe5634abefce547052cbc8ed2`

function createValidHash(originalId, userName) {
    const sha1sum = crypto.createHash('sha1');
    sha1sum.update(originalId + userName + secretKey);
    return sha1sum.digest('hex');
}

function handleRedirectPosts(req, res) {
    res.writeHead(303, {
        'Location': '/posts'
    });
    res.end();
}

module.exports = {
    handle,
    handleDelete
};