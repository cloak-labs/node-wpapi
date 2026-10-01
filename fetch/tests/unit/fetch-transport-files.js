'use strict';

const fs = require( 'fs' );
const os = require( 'os' );
const path = require( 'path' );
const { File } = require( 'buffer' );
const fetchTransport = require( '../../fetch-transport' );

if ( typeof FormData === 'undefined' ) {
	// Jest 24's Node environment predates global FormData. Next.js/Node 18+ have it.
	global.FormData = class FormData {
		constructor() {
			this._entries = [];
		}
		append( key, value, _filename ) {
			this._entries.push( [ key, value ] );
		}
		get( key ) {
			const match = this._entries.find( ( entry ) => entry[0] === key );
			return match ? match[1] : null;
		}
		forEach( callback ) {
			this._entries.forEach( ( [ key, value ] ) => callback( value, key ) );
		}
	};
}

function mockOkFetch() {
	global.fetch = jest.fn().mockResolvedValue( {
		ok: true,
		json: () => Promise.resolve( { id: 42 } ),
		headers: {
			forEach: () => {},
		},
	} );
}

function request( overrides ) {
	return Object.assign( {
		toString: () => 'http://example.com/wp-json/wp/v2/media',
		_options: {},
		_attachment: undefined,
		_attachmentName: undefined,
		_single: false,
	}, overrides );
}

function formEntries( formData ) {
	const entries = [];
	formData.forEach( ( value, key ) => {
		entries.push( [ key, value ] );
	} );
	return entries;
}

describe( 'fetch transport .file() uploads', () => {
	const originalFetch = global.fetch;

	afterEach( () => {
		global.fetch = originalFetch;
	} );

	it( 'uploads a File/Blob without requiring a global fs binding', async () => {
		mockOkFetch();
		const file = new File( [ Buffer.from( [ 1, 2, 3 ] ) ], 'resume.pdf', {
			type: 'application/pdf',
		} );

		const result = await fetchTransport.post(
			request( {
				_attachment: file,
				_attachmentName: 'resume.pdf',
			} ),
			{
				post: 99,
				status: 'private',
				meta: {
					_form_submission_attachment: '1',
				},
			}
		);

		expect( result ).toEqual( { id: 42 } );
		expect( global.fetch ).toHaveBeenCalledTimes( 1 );

		const [ url, config ] = global.fetch.mock.calls[0];
		expect( url ).toBe( 'http://example.com/wp-json/wp/v2/media' );
		expect( config.method ).toBe( 'POST' );
		expect( config.body ).toBeInstanceOf( FormData );
		expect( config.headers && config.headers['Content-Type'] ).toBeUndefined();

		const keys = formEntries( config.body ).map( ( [ key ] ) => key );
		expect( keys ).toContain( 'file' );
		expect( keys ).toContain( 'post' );
		expect( keys ).toContain( 'status' );
		expect( keys ).toContain( 'meta[_form_submission_attachment]' );
		expect( config.body.get( 'post' ) ).toBe( '99' );
		expect( config.body.get( 'status' ) ).toBe( 'private' );
		expect( config.body.get( 'meta[_form_submission_attachment]' ) ).toBe( '1' );
	} );

	it( 'uploads a Buffer when a filename is provided', async () => {
		mockOkFetch();

		await fetchTransport.post(
			request( {
				_attachment: Buffer.from( 'hello' ),
				_attachmentName: 'hello.txt',
			} ),
			{ title: 'hello.txt' }
		);

		const [ , config ] = global.fetch.mock.calls[0];
		expect( config.body ).toBeInstanceOf( FormData );
		expect( config.body.get( 'title' ) ).toBe( 'hello.txt' );
		expect( config.body.get( 'file' ) ).toBeTruthy();
	} );

	it( 'reads a filesystem path in Node and uploads it as a file', async () => {
		mockOkFetch();
		const filePath = path.join( os.tmpdir(), `wpapi-upload-${Date.now()}.txt` );
		fs.writeFileSync( filePath, 'from-disk' );

		try {
			await fetchTransport.post(
				request( { _attachment: filePath } ),
				{}
			);
		} finally {
			fs.unlinkSync( filePath );
		}

		const [ , config ] = global.fetch.mock.calls[0];
		expect( config.body ).toBeInstanceOf( FormData );
		expect( config.body.get( 'file' ) ).toBeTruthy();
	} );

	it( 'still JSON-encodes POSTs without an attachment', async () => {
		mockOkFetch();

		await fetchTransport.post( request(), { title: 'Ada Lovelace' } );

		const [ , config ] = global.fetch.mock.calls[0];
		expect( config.headers['Content-Type'] ).toBe( 'application/json' );
		expect( config.body ).toBe( JSON.stringify( { title: 'Ada Lovelace' } ) );
	} );
} );
