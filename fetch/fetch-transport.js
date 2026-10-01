/**
 * @module fetch-transport
 */
'use strict';

const objectReduce = require('../lib/util/object-reduce');
const { createPaginationObject } = require('../lib/pagination');

/**
 * Utility method to set a header value on a fetch configuration object.
 *
 * @method _setHeader
 * @private
 * @param {Object} config A configuration object of unknown completeness
 * @param {string} header String name of the header to set
 * @param {string} value  Value of the header to set
 * @returns {Object} The modified configuration object
 */
const _setHeader = (config, header, value) => ({
	...config,
	headers: {
		...(config && config.headers ? config.headers : null),
		[header]: value,
	},
});

/**
 * Set any provided headers on the outgoing request object. Runs after _auth.
 *
 * @method _setHeaders
 * @private
 * @param {Object} config A fetch request configuration object
 * @param {Object} options A WPRequest _options object
 * @param {Object} A fetch config object, with any available headers set
 */
function _setHeaders(config, options) {
	// If there's no headers, do nothing
	if (!options.headers) {
		return config;
	}

	return objectReduce(
		options.headers,
		(config, value, key) => _setHeader(config, key, value),
		config,
	);
}

/**
 * Conditionally set basic or nonce authentication on a server request object.
 *
 * @method _auth
 * @private
 * @param {Object} config A fetch request configuration object
 * @param {Object} options A WPRequest _options object
 * @param {Boolean} forceAuthentication whether to force authentication on the request
 * @param {Object} A fetch request object, conditionally configured to use basic auth
 */
function _auth(config, options, forceAuthentication) {
	// If we're not supposed to authenticate, don't even start
	if (!forceAuthentication && !options.auth && !options.nonce) {
		return config;
	}

	// Enable nonce in options for Cookie authentication http://wp-api.org/guides/authentication.html
	if (options.nonce) {
		config.credentials = 'same-origin';
		return _setHeader(config, 'X-WP-Nonce', options.nonce);
	}

	// If no username or no password, can't authenticate
	if (!options.username || !options.password) {
		return config;
	}

	// Can authenticate: set basic auth parameters on the config
	let authorization = `${options.username}:${options.password}`;
	if (global.Buffer) {
		authorization = global.Buffer.from(authorization).toString('base64');
	} else if (global.btoa) {
		authorization = global.btoa(authorization);
	}

	return _setHeader(config, 'Authorization', `Basic ${authorization}`);
}

// HTTP-Related Helpers
// ====================

/**
 * Get the response headers as a regular JavaScript object.
 *
 * @param {Object} response Fetch response object.
 */
function getHeaders(response) {
	const headers = {};
	response.headers.forEach((value, key) => {
		headers[key] = value;
	});
	return headers;
}

/**
 * Return the body of the request, augmented with pagination information if the
 * result is a paged collection.
 *
 * @private
 * @param {WPRequest} wpreq The WPRequest representing the returned HTTP response
 * @param {Object} response The fetch response object for the HTTP call
 * @returns {Object} The JSON data of the response, conditionally augmented with
 *                   pagination information if the response is a partial collection.
 */
const parseFetchResponse = (response, wpreq) => {
	// Check if an HTTP error occurred.
	if (!response.ok) {
		// Extract and return the API-provided error object if the response is
		// not ok, i.e. if the error was from the API and not internal to fetch.
		return response.json().then(
			(err) => {
				// Throw the error object to permit proper error handling.
				throw err;
			},
			() => {
				// JSON serialization failed; throw the underlying response.
				throw response;
			},
		);
	}

	// If the response is OK, process & return the JSON data.
	return response.json().then((body) => {
		if (wpreq._single) return body[0];

		// Construct a response the pagination helper can understand.
		const mockResponse = {
			headers: getHeaders(response),
		};

		const _paging = createPaginationObject(
			mockResponse,
			wpreq._options,
			wpreq.transport,
		);
		if (_paging) {
			body._paging = _paging;
		}
		return body;
	});
};

/**
 * Native `FormData` (browser and Node 18+ fetch) accepts Blob/File values, not
 * Node ReadStreams. Flatten nested JSON the way PHP expects multipart fields.
 *
 * @param {FormData} form
 * @param {string} key
 * @param {*} value
 */
function appendFormValue(form, key, value) {
	if (value === undefined || value === null) {
		return;
	}

	if (isBlobLike(value)) {
		form.append(key, value);
		return;
	}

	if (Array.isArray(value)) {
		value.forEach((item, index) => {
			appendFormValue(form, `${key}[${index}]`, item);
		});
		return;
	}

	if (typeof value === 'object') {
		Object.keys(value).forEach((childKey) => {
			appendFormValue(form, `${key}[${childKey}]`, value[childKey]);
		});
		return;
	}

	form.append(key, String(value));
}

function isBlobLike(value) {
	return (
		value &&
		typeof value === 'object' &&
		typeof value.arrayBuffer === 'function' &&
		typeof value.size === 'number'
	);
}

function isBufferLike(value) {
	if (typeof Buffer !== 'undefined' && Buffer.isBuffer(value)) {
		return true;
	}
	return typeof Uint8Array !== 'undefined' && value instanceof Uint8Array;
}

function fileNameFromPath(filePath) {
	const parts = String(filePath).split(/[/\\]/);
	return parts[parts.length - 1] || 'file';
}

function readFileFromPath(filePath) {
	let fs;
	try {
		// Only used for filesystem-path uploads. Blob/File/Buffer callers
		// (Next.js, browsers) never enter this function, so webpack does not
		// need to provide `fs` on those paths.
		fs = require('fs');
	} catch (err) {
		fs = null;
	}

	if (!fs || !fs.promises || typeof fs.promises.readFile !== 'function') {
		return Promise.reject(
			new Error(
				'Attaching files by path only works when the request is invoked in a Node.js environment.',
			),
		);
	}

	return fs.promises.readFile(filePath);
}

function nodeBufferApi() {
	try {
		return require('buffer');
	} catch (err) {
		return null;
	}
}

function getFileCtor() {
	if (typeof File === 'function') {
		return File;
	}
	const bufferApi = nodeBufferApi();
	return bufferApi && bufferApi.File ? bufferApi.File : null;
}

function getBlobCtor() {
	if (typeof Blob === 'function') {
		return Blob;
	}
	const bufferApi = nodeBufferApi();
	return bufferApi && bufferApi.Blob ? bufferApi.Blob : null;
}

function wrapBytes(bytes, filename) {
	const FileCtor = getFileCtor();
	if (typeof FileCtor === 'function') {
		return {
			blob: new FileCtor([bytes], filename),
			filename,
		};
	}

	const BlobCtor = getBlobCtor();
	if (typeof BlobCtor === 'function') {
		return {
			blob: new BlobCtor([bytes]),
			filename,
		};
	}

	throw new Error(
		'Blob/File is not available in this environment; cannot attach a file to the request.',
	);
}

/**
 * Convert a `.file()` argument into a Blob/File that native FormData can send.
 *
 * @param {string|Blob|File|Buffer|Uint8Array} file
 * @param {string} [filename]
 * @returns {Promise<{ blob: Blob, filename: string }>}
 */
async function toFormDataBlob(file, filename) {
	if (typeof file === 'string') {
		const bytes = await readFileFromPath(file);
		return wrapBytes(bytes, filename || fileNameFromPath(file));
	}

	if (isBlobLike(file)) {
		return {
			blob: file,
			filename: filename || file.name || 'file',
		};
	}

	if (isBufferLike(file)) {
		if (!filename) {
			throw new Error(
				'.file(): File name is a required argument when uploading a Buffer',
			);
		}
		return wrapBytes(file, filename);
	}

	throw new Error('.file() requires a filesystem path, Buffer, Blob, or File.');
}

function getFormDataCtor() {
	if (typeof FormData === 'function') {
		return FormData;
	}
	throw new Error(
		'FormData is not available in this environment; cannot attach a file to the request.',
	);
}

async function buildAttachmentForm(wpreq, data) {
	const { blob, filename } = await toFormDataBlob(
		wpreq._attachment,
		wpreq._attachmentName,
	);
	const FormDataCtor = getFormDataCtor();
	const form = new FormDataCtor();
	form.append('file', blob, filename);
	Object.keys(data).forEach((key) => appendFormValue(form, key, data[key]));
	return form;
}

// HTTP Methods: Private HTTP-verb versions
// ========================================

const send = (wpreq, config) =>
	fetch(
		wpreq.toString(),
		_setHeaders(_auth(config, wpreq._options), wpreq._options),
	).then((response) => {
		// return response.headers.get( 'Link' );
		return parseFetchResponse(response, wpreq);
	});

/**
 * @method get
 * @async
 * @param {WPRequest} wpreq A WPRequest query object
 * @returns {Promise} A promise to the results of the HTTP request
 */
function _httpGet(wpreq) {
	return send(wpreq, {
		method: 'GET',
	});
}

/**
 * Invoke an HTTP "POST" request against the provided endpoint
 * @method post
 * @async
 * @param {WPRequest} wpreq A WPRequest query object
 * @param {Object} data The data for the POST request
 * @returns {Promise} A promise to the results of the HTTP request
 */
async function _httpPost(wpreq, data = {}) {
	if (wpreq._attachment) {
		const form = await buildAttachmentForm(wpreq, data);
		return send(wpreq, {
			method: 'POST',
			redirect: 'follow',
			body: form,
		});
	}

	return send(wpreq, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		redirect: 'follow',
		body: JSON.stringify(data),
	});
}

/**
 * @method put
 * @async
 * @param {WPRequest} wpreq A WPRequest query object
 * @param {Object} data The data for the PUT request
 * @returns {Promise} A promise to the results of the HTTP request
 */
function _httpPut(wpreq, data = {}) {
	return send(wpreq, {
		method: 'PUT',
		headers: {
			'Content-Type': 'application/json',
		},
		redirect: 'follow',
		body: JSON.stringify(data),
	});
}

/**
 * @method delete
 * @async
 * @param {WPRequest} wpreq A WPRequest query object
 * @param {Object} [data] Data to send along with the DELETE request
 * @returns {Promise} A promise to the results of the HTTP request
 */
function _httpDelete(wpreq, data) {
	const config = {
		method: 'DELETE',
		headers: {
			'Content-Type': 'application/json',
		},
		redirect: 'follow',
	};

	if (data) {
		config.body = JSON.stringify(data);
	}

	return send(wpreq, config);
}

/**
 * @method head
 * @async
 * @param {WPRequest} wpreq A WPRequest query object
 * @returns {Promise} A promise to the header results of the HTTP request
 */
function _httpHead(wpreq) {
	const url = wpreq.toString();
	const config = _setHeaders(
		_auth(
			{
				method: 'HEAD',
			},
			wpreq._options,
			true,
		),
		wpreq._options,
	);

	return fetch(url, config).then((response) => getHeaders(response));
}

module.exports = {
	delete: _httpDelete,
	get: _httpGet,
	head: _httpHead,
	post: _httpPost,
	put: _httpPut,
};
