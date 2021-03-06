/*
 * CursorEvents dispatches Cursor API events to the target object.
 * Thus you can attach event listeners to objects instead of the window:
 * myObject.addEventListener( "holocursorenter", myEventHandler );
 *
 * Can also manage AltObjectControls and CursorEffects, if enabled then
 * those two libraries are also required for this one to function.
 *
 * Author: Amber Roy
 * Copyright (c) 2015 AltspaceVR
 */

CursorEvents = function( scene, params ) {

	// Passing the scene to this constructor tells this class to expect new cursor events.
	// Otherwise, expect the old events, with "holo" prefix.

	if ( !scene || ! scene instanceof THREE.Scene ) {
		// Workaround for older version where events attached to window instead of scene.
		console.log("CursorEvents using old event format");
		params = scene;
		scene = null;
		this.oldEventFormat = true;
	} else {
		this.oldEventFormat = false;
	}

	this.scene = scene;

	var p = params || {};

	// Debugging log
	this.TRACE = p.TRACE;

	// Dispatch events without a target to this object.
	this.defaultTarget = p.defaultTarget || null;


	this.objectLookup = {};  // objectLookup[ object.uuid ] = object

	this.childMeshToObject = {};  // childMeshToObject[ child.uuid ] = object 

	// Cursor Effects
	this.objectEffects = {};  // objectEffects[ object.uuid ] = [ effect1, effect2, ... ]
	this.effects = [];  // flat list of all effects
	this.effectsState = {}; // built-in: copy of lastEvent, other values added by effects

	this.inAltspace = !!window.altspace;

	if ( this.inAltspace ) {

		var dispatcher = this._cursorEventDispatch.bind( this ); 

		// Cursor Events from Altspace
		if ( this.oldEventFormat ) {

			// TEMP until we decommission "holo" prefix
			window.addEventListener("holocursormove", dispatcher);
			window.addEventListener("holocursordown", dispatcher);
			window.addEventListener("holocursorup", dispatcher);
			window.addEventListener("holocursorenter", dispatcher);
			window.addEventListener("holocursorleave", dispatcher);

		} else {

			// For now "cursormove" is the only one fired on scene but not on object.
			// We should also fire "cursorup" on scene to handle the case where cursor
			// moves/drags off object before being released.
			this.scene.addEventListener("cursormove", dispatcher);

		}

	}

};


CursorEvents.prototype.addEffect = function( effect, object ) {

	if ( !object || !effect ) {
		console.error("AddEffect requires a valid effect and object", effect, object );
		return ; // sanity check
	}

	if ( !this.objectEffects[ object.uuid ] ) {

		// First time an effect added to this object, initialize it.
		this.objectEffects[ object.uuid ] = [];		

	}

	if ( this.effects.indexOf( effect ) === -1 ) {
		this.effects.push( effect );
	}

	if ( object ) {

		this.objectEffects[ object.uuid ].push( effect );

	} else {

		// If no object given, add this effect for all objects.
		var uuids = Object.keys( this.objectEffects );
		for (var i=0; i < uuids.length; i++) {

			this.objectEffects[ uuids[i] ].push( effect ); 

		}

	}

};	


CursorEvents.prototype.enableMouseEvents = function( camera ) {

	if ( this.inAltspace ) return ; // in Altspace, use cursor events only

	if ( !camera ) {
		console.error( "Camera required to enableMouseEvents");
		return; // Withotu a camera, cannot use the raycaster.
	}
	this.camera = camera;

	this.objectControlsDelegate = new THREE.Object3D(); // dummy object
	var params = {
		recursive: true,
		delegate: this.objectControlsDelegate
	};
	this.objectControls = new AltObjectControls( this.camera, params );

	var dispatcher = this._objectControlsDispatch.bind( this ); 

	this.objectControlsDelegate.hoverOver = dispatcher;
	this.objectControlsDelegate.hoverOut = dispatcher;
	this.objectControlsDelegate.select = dispatcher;
	this.objectControlsDelegate.deselect = dispatcher;
	this.objectControlsDelegate.move = dispatcher;

};

CursorEvents.prototype.update = function() {
	
	if ( this.objectControls ) {

		this.objectControls.update();

	}

	this._updateEffects();

};

CursorEvents.prototype.addObject = function( object ) {
	// TODO: Corresponding removeEffect method.

	if ( !object ) {
		console.error("CursorEvents.addObject expected one argument");
		return ; // sanity check
	}

	if ( !this.objectLookup[ object.uuid ] ) {

		if ( !this.oldEventFormat ) {

			// New object, attach listeners. Attach to child[0], since currently
			// events are fired against it (the THREE.Mesh).
			var dispatcher = this._cursorEventDispatch.bind( this ); 
			object.children[0].addEventListener("cursordown", dispatcher);
			object.children[0].addEventListener("cursorup", dispatcher);
			object.children[0].addEventListener("cursorenter", dispatcher);
			object.children[0].addEventListener("cursorleave", dispatcher);

		}

		// Add uuid to lookup table.
		this.objectLookup[ object.uuid ] = object;

		if ( this.objectControls ) {
			this.objectControls.add( object );
		}

		if ( this.inAltspace ) {

			// workaround for events fired on child mesh instead of top-level object
			object.traverse( function( child ) {

				if ( child instanceof THREE.Mesh ) {
					this.childMeshToObject[ child.uuid ] = object;
				}

			}.bind(this));

		}

	}

};

CursorEvents.prototype._cursorEventDispatch = function( event ) {

	var detail = this._createEventDetail( event );
	var objectEvent = {type: event.type, detail: detail};

	if ( this.TRACE ) console.log(event.type, detail);

	// Use uuid to map from Altspace object to its corresponding ThreeJS object.
	// Currently cursor events fire on all objects, even non-interactive ones,
	// so only dispatch events on objects that have been added to objectControls.

	var targetUuid = objectEvent.detail.targetUuid;
	if ( targetUuid ) {

		var targetObject = this.objectLookup[ targetUuid ];

		if ( !targetObject && this.inAltspace ) {
			// workaround for events fired on child mesh instead of top-level object
			targetObject = this.childMeshToObject[ targetUuid ];
		}

		if ( targetObject ) {

			targetObject.dispatchEvent( objectEvent );

			this._dispatchEffects( targetObject, objectEvent );

		} else {
			// This can happen if there are objects in the scene that have not been
			// added to CursorEvents, since they are not interactive, like Chess board.
			if ( this.TRACE ) console.log("No target object for uuid ", targetUuid);
		}

	} else {

		// For events not associated with an object, dispatch on defaultTarget.
		// Currently only one is "holocursormove"
		if ( this.defaultTarget ) {

			this.defaultTarget.dispatchEvent( objectEvent );

		}

		// Always dispatch to objectEffects, which needs latest ray
		// for effects like drag, otherwise cursor can "escpace" object.
		this._dispatchEffects( this.defaultTarget, objectEvent );

	}

};

CursorEvents.prototype._objectControlsDispatch = function( object, eventDetail ) {

	if ( this.TRACE ) console.log("objectControls " + eventDetail.name, eventDetail);

	var eventNameMapping;
	if ( this.oldEventFormat ) {

		eventNameMapping = {
			// TEMP until we decommission "holo" prefix
			"hoverOver" : "holocursorenter",
			"hoverOut" : "holocursorleave",
			"select" : "holocursordown",
			"deselect" : "holocursorup",
			"move" : "holocursormove",
		};

	} else {

		eventNameMapping = {
			"hoverOver" : "cursorenter",
			"hoverOut" : "cursorleave",
			"select" : "cursordown",
			"deselect" : "cursorup",
			"move" : "cursormove",
		};

	}

	var eventName = eventNameMapping[ eventDetail.name ];

	if ( !eventName ) {console.error("AltObjectControls event name unrecognized", eventName);
		return ; // Cannot map event to cursor event.
	}

	var mockCursorEvent = {
		type: eventName,
		targetUuid: eventDetail.name !== "move" ? object.uuid : null,
		ray: eventDetail.raycaster.ray,
	};

	this._cursorEventDispatch( mockCursorEvent );

};

CursorEvents.prototype._createEventDetail = function( event ) {

	var origin = new THREE.Vector3(
		event.ray.origin.x,
		event.ray.origin.y,
		event.ray.origin.z
	);

	var direction = new THREE.Vector3(
		event.ray.direction.x,
		event.ray.direction.y,
		event.ray.direction.z
	);

	var ray = new THREE.Ray( origin, direction );

	// All custom event data should go in the detail object.
	// TODO: Fix original event generated by Altspace.

	var targetUuid;
	if ( !this.inAltspace || this.oldEventFormat ) {

		// TEMP: support old event format: event.targetUuid,
		// which is also what we emulate when running outside Altspace.
		targetUuid = event.targetUuid;

	} else {

		targetUuid = event.target.uuid;
		if ( targetUuid === this.scene.uuid ) {

			// If event fired on scene, clear uuid which we expect to refer to an object.
			targetUuid = null;

		}

	}

	var detail = {
		targetUuid: targetUuid,
		ray: ray,
	};

	return detail;
};


CursorEvents.prototype._dispatchEffects = function( object, event ) {

	// Save most recent event, for effects that track ray (like drag).
	this.effectsState.lastEvent = event;

	// No object (e.g. move event with no defaultTarget) or no effects for object.
	if ( !object || !this.objectEffects[ object.uuid ] ) return ;

	var effects = this.objectEffects[ object.uuid ];
	for ( var i=0; i < effects.length; i++) {

		var effect = effects[ i ];
		var effectCallback = null;

		if ( effect[ event.type ]) {

			effectCallback = effect[ event.type ].bind( effect );
			effectCallback( object, event );

		} else {

			// TEMP: support old event names, for now.
			if ( effect[ "holo" + event.type ]) {

				effectCallback = effect[ "holo" + event.type ].bind( effect );
				effectCallback( object, event );
			}

		}
	}

};


CursorEvents.prototype._updateEffects = function() {

	// Call update( this.effectState ) on all effects that define it.
	// Optional return value is the new effect state, useful for effects
	// that need to share state between them. Note we are chaining updates,
	// so an effect that depends on state managed by other events should
	// be added after them.

	for (var i=0; i < this.effects.length; i++) {

		var effect = this.effects[i];
		if ( effect.update ) {

			var newEffectsState = effect.update( this.effectsState );
			if ( newEffectsState ) {

				this.effectsState = newEffectsState;

			}

		}

	}

};



