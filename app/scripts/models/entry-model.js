'use strict';

var Backbone = require('backbone'),
    AttachmentModel = require('./attachment-model'),
    IconMap = require('../const/icon-map'),
    Color = require('../util/color'),
    IconUrl = require('../util/icon-url'),
    kdbxweb = require('kdbxweb');

var EntryModel = Backbone.Model.extend({
    defaults: {},

    buildInFields: ['Title', 'Password', 'Notes', 'URL', 'UserName'],

    initialize: function() {
    },

    setEntry: function(entry, group, file) {
        this.entry = entry;
        this.group = group;
        this.file = file;
        if (this.id === entry.uuid.id) {
            this._checkUpdatedEntry();
        }
        this._fillByEntry();
    },

    _fillByEntry: function() {
        var entry = this.entry;
        this.set({id: entry.uuid.id}, {silent: true});
        this.fileName = this.file.get('name');
        this.title = entry.fields.Title || '';
        this.password = entry.fields.Password || kdbxweb.ProtectedValue.fromString('');
        this.notes = entry.fields.Notes || '';
        this.url = entry.fields.URL || '';
        this.user = entry.fields.UserName || '';
        this.iconId = entry.icon;
        this.icon = this._iconFromId(entry.icon);
        this.tags = entry.tags;
        this.color = this._colorToModel(entry.bgColor) || this._colorToModel(entry.fgColor);
        this.fields = this._fieldsToModel(entry.fields);
        this.attachments = this._attachmentsToModel(entry.binaries);
        this.created = entry.times.creationTime;
        this.updated = entry.times.lastModTime;
        this.expires = entry.times.expires ? entry.times.expiryTime : undefined;
        this.expired = entry.times.expires && entry.times.expiryTime <= new Date();
        this.historyLength = entry.history.length;
        this._buildCustomIcon();
        this._buildSearchText();
        this._buildSearchTags();
        this._buildSearchColor();
    },

    _checkUpdatedEntry: function() {
        if (this.isJustCreated) {
            this.isJustCreated = false;
        }
        if (this.unsaved && +this.updated !== +this.entry.times.lastModTime) {
            this.unsaved = false;
        }
    },

    _buildSearchText: function() {
        var text = '';
        _.forEach(this.entry.fields, function(value) {
            if (typeof value === 'string') {
                text += value.toLowerCase() + '\n';
            }
        });
        this.entry.tags.forEach(function(tag) {
            text += tag.toLowerCase() + '\n';
        });
        this.attachments.forEach(function(att) {
            text += att.title.toLowerCase() + '\n';
        });
        this.searchText = text;
    },

    _buildCustomIcon: function() {
        this.customIcon = null;
        this.customIconId = null;
        if (this.entry.customIcon) {
            this.customIcon = IconUrl.toDataUrl(this.file.db.meta.customIcons[this.entry.customIcon]);
            this.customIconId = this.entry.customIcon.toString();
        }
    },

    _buildSearchTags: function() {
        this.searchTags = this.entry.tags.map(function(tag) { return tag.toLowerCase(); });
    },

    _buildSearchColor: function() {
        this.searchColor = this.color;
    },

    _iconFromId: function(id) {
        return IconMap[id];
    },

    _colorToModel: function(color) {
        return color ? Color.getNearest(color) : null;
    },

    _fieldsToModel: function(fields) {
        return _.omit(fields, this.buildInFields);
    },

    _attachmentsToModel: function(binaries) {
        var att = [];
        _.forEach(binaries, function(data, title) {
            att.push(AttachmentModel.fromAttachment({ data: data, title: title }));
        }, this);
        return att;
    },

    _entryModified: function() {
        if (!this.unsaved) {
            this.unsaved = true;
            this.entry.pushHistory();
            this.file.setModified();
        }
        if (this.isJustCreated) {
            this.isJustCreated = false;
        }
        this.entry.times.update();
    },

    matches: function(filter) {
        return !filter ||
            (!filter.tagLower || this.searchTags.indexOf(filter.tagLower) >= 0) &&
            (!filter.textLower || this.searchText.indexOf(filter.textLower) >= 0) &&
            (!filter.color || filter.color === true && this.searchColor || this.searchColor === filter.color);
    },

    setColor: function(color) {
        this._entryModified();
        this.entry.bgColor = Color.getKnownBgColor(color);
        this._fillByEntry();
    },

    setIcon: function(iconId) {
        this._entryModified();
        this.entry.icon = iconId;
        this.entry.customIcon = undefined;
        this._fillByEntry();
    },

    setCustomIcon: function(customIconId) {
        this._entryModified();
        this.entry.customIcon = new kdbxweb.KdbxUuid(customIconId);
        this._fillByEntry();
    },

    setExpires: function(dt) {
        this._entryModified();
        this.entry.times.expiryTime = dt instanceof Date ? dt : undefined;
        this.entry.times.expires = !!dt;
        this._fillByEntry();
    },

    setTags: function(tags) {
        this._entryModified();
        this.entry.tags = tags;
        this._fillByEntry();
    },

    setField: function(field, val) {
        this._entryModified();
        var hasValue = val && (typeof val === 'string' || val instanceof kdbxweb.ProtectedValue && val.byteLength);
        if (hasValue || this.buildInFields.indexOf(field) >= 0) {
            this.entry.fields[field] = val;
        } else {
            delete this.entry.fields[field];
        }
        this._fillByEntry();
    },

    hasField: function(field) {
        return this.entry.fields.hasOwnProperty(field);
    },

    addAttachment: function(name, data) {
        this._entryModified();
        this.entry.binaries[name] = kdbxweb.ProtectedValue.fromBinary(data);
        this._fillByEntry();
    },

    removeAttachment: function(name) {
        this._entryModified();
        delete this.entry.binaries[name];
        this._fillByEntry();
    },

    getHistory: function() {
        var history = this.entry.history.map(function(rec) {
            return EntryModel.fromEntry(rec, this.group, this.file);
        }, this);
        history.push(this);
        history.sort(function(x, y) { return x.updated - y.updated; });
        return history;
    },

    deleteHistory: function(historyEntry) {
        var ix = this.entry.history.indexOf(historyEntry);
        if (ix >= 0) {
            this.entry.removeHistory(ix);
        }
        this._fillByEntry();
    },

    revertToHistoryState: function(historyEntry) {
        var ix = this.entry.history.indexOf(historyEntry);
        if (ix < 0) {
            return;
        }
        this.entry.pushHistory();
        this.unsaved = true;
        this.file.setModified();
        this.entry.fields = {};
        this.entry.binaries = {};
        this.entry.copyFrom(historyEntry);
        this._entryModified();
        this._fillByEntry();
    },

    discardUnsaved: function() {
        if (this.unsaved && this.entry.history.length) {
            this.unsaved = false;
            var historyEntry = this.entry.history[this.entry.history.length - 1];
            this.entry.removeHistory(this.entry.history.length - 1);
            this.entry.fields = {};
            this.entry.binaries = {};
            this.entry.copyFrom(historyEntry);
            this._fillByEntry();
        }
    },

    moveToTrash: function() {
        this.file.setModified();
        if (this.isJustCreated) {
            this.isJustCreated = false;
        }
        this.file.db.remove(this.entry);
        this.file.reload();
    },

    deleteFromTrash: function() {
        this.file.setModified();
        this.file.db.move(this.entry, null);
        this.file.reload();
    },

    removeWithoutHistory: function() {
        var ix = this.group.group.entries.indexOf(this.entry);
        if (ix >= 0) {
            this.group.group.entries.splice(ix, 1);
        }
        this.file.reload();
    }
});

EntryModel.fromEntry = function(entry, group, file) {
    var model = new EntryModel();
    model.setEntry(entry, group, file);
    return model;
};

EntryModel.newEntry = function(group, file) {
    var model = new EntryModel();
    var entry = file.db.createEntry(group.group);
    model.setEntry(entry, group, file);
    model.entry.times.update();
    model.unsaved = true;
    model.isJustCreated = true;
    group.addEntry(model);
    file.setModified();
    return model;
};

module.exports = EntryModel;
